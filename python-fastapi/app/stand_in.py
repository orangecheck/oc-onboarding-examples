"""Offline mode only: stand-ins for ochk.io's sign-in popup and key set, the Connect
API and ochk.app's claim page, answering in the same shapes (the SDK's own result
types), so the funnel can be clicked through with no account anywhere."""

import base64
import hashlib
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from orangecheck import ConnectAccount, ConnectClaimLink, ConnectDeleted, ConnectRefusal

from .config import cfg
from .db import db, now
from .users import mark_connect_claimed

KID = "stand-in"
_key: Ed25519PrivateKey | None = None
_claim_tokens: dict[str, tuple[str, int]] = {}


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def issuer() -> str:
    return f"{cfg().site_origin}/stand-in"


def _private_key() -> Ed25519PrivateKey:
    """Kept in .data/ so tokens survive a restart; in memory only for an in-memory database."""
    global _key
    if _key is None:
        path = Path(".data/stand-in-key.json")
        if os.environ.get("DB_PATH") != ":memory:" and path.exists():
            raw = base64.b64decode(json.loads(path.read_text())["d"])
            _key = Ed25519PrivateKey.from_private_bytes(raw)
        else:
            _key = Ed25519PrivateKey.generate()
            if os.environ.get("DB_PATH") != ":memory:":
                path.parent.mkdir(parents=True, exist_ok=True)
                raw = _key.private_bytes(
                    serialization.Encoding.Raw,
                    serialization.PrivateFormat.Raw,
                    serialization.NoEncryption(),
                )
                path.write_text(json.dumps({"d": base64.b64encode(raw).decode()}))
                path.chmod(0o600)
    return _key


def jwks() -> dict:
    x = (
        _private_key()
        .public_key()
        .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    )
    return {"keys": [{"kty": "OKP", "crv": "Ed25519", "x": _b64u(x), "kid": KID, "alg": "EdDSA"}]}


def did_for(name: str) -> str:
    return "did:oc:" + hashlib.sha256(f"stand-in:{name.lower()}".encode()).hexdigest()[:32]


def sign(claims: dict) -> str:
    """A token signed by the stand-in key. Tests use it for tokens the popup never issues."""
    header = _b64u(json.dumps({"alg": "EdDSA", "kid": KID, "typ": "JWT"}).encode())
    body = _b64u(json.dumps(claims).encode())
    signature = _private_key().sign(f"{header}.{body}".encode())
    return f"{header}.{body}.{_b64u(signature)}"


def token(name: str) -> dict:
    """What the popup hands the page: a token bound to this site's origin, with an rh."""
    did = did_for(name)
    t = int(time.time())
    claims = {
        "iss": issuer(),
        "aud": cfg().site_origin,
        "sub": "stand-in-" + did[-8:],
        "did_oc": did,
        "rh": secrets.token_urlsafe(16),
        "jti": str(uuid.uuid4()),
        "iat": t,
        "exp": t + 3600,
    }
    return {"token": sign(claims), "account": {"did_oc": did, "display_name": name}}


# ---- Connect ----


def _row(user_id: str):
    return db().execute("SELECT * FROM stand_in_connect WHERE user_id = ?", (user_id,)).fetchone()


def _fresh_did() -> str:
    return "did:oc:" + secrets.token_hex(16)


def provision(user_id: str, consent: bool) -> ConnectAccount | ConnectRefusal:
    r = _row(user_id)
    if r and r["deleted"]:
        if not consent:
            return ConnectRefusal(reason="account_deleted", status=410)
        did = _fresh_did()
        db().execute(
            "UPDATE stand_in_connect SET did_oc = ?, consent = 1, claimed = 0, deleted = 0 "
            "WHERE user_id = ?",
            (did, user_id),
        )
        return ConnectAccount(did_oc=did, is_new=True)
    if r:
        if consent:
            db().execute("UPDATE stand_in_connect SET consent = 1 WHERE user_id = ?", (user_id,))
        return ConnectAccount(did_oc=r["did_oc"], is_new=False)
    did = _fresh_did()
    db().execute(
        "INSERT INTO stand_in_connect (user_id, did_oc, consent) VALUES (?, ?, ?)",
        (user_id, did, 1 if consent else 0),
    )
    return ConnectAccount(did_oc=did, is_new=True)


def claim_link(user_id: str) -> ConnectClaimLink | ConnectRefusal:
    r = _row(user_id)
    if not r or r["deleted"]:
        return ConnectRefusal(reason="unknown_user", status=404)
    if r["claimed"]:
        return ConnectRefusal(reason="already_claimed", status=409)
    for t, (uid, _) in list(_claim_tokens.items()):
        if uid == user_id:
            del _claim_tokens[t]  # a new link closes the last
    t = secrets.token_urlsafe(24)
    exp = now() + 15 * 60
    _claim_tokens[t] = (user_id, exp)
    expires = datetime.fromtimestamp(exp, timezone.utc).isoformat()
    return ConnectClaimLink(url=f"{cfg().site_origin}/stand-in/claim#t={t}", expires_at=expires)


def claim(t: str) -> bool:
    """What ochk.app does when the person confirms: the account is theirs, and the site
    hears connect.claimed."""
    hit = _claim_tokens.pop(t, None)
    if not hit or hit[1] < now():
        return False
    r = _row(hit[0])
    if not r or r["deleted"]:
        return False
    db().execute("UPDATE stand_in_connect SET claimed = 1 WHERE user_id = ?", (hit[0],))
    mark_connect_claimed(r["did_oc"])
    return True


def delete(user_id: str) -> ConnectDeleted:
    r = _row(user_id)
    if not r or r["deleted"]:
        return ConnectDeleted(result="already_deleted")
    db().execute("UPDATE stand_in_connect SET deleted = 1 WHERE user_id = ?", (user_id,))
    return ConnectDeleted(result="detached" if r["claimed"] else "deleted")


def reset_for_tests() -> None:
    global _key
    _key = None
    _claim_tokens.clear()
