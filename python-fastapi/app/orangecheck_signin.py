"""Sign in with orangecheck (ochk.io/docs/me/quickstart). The page sends the popup's
token once, as a Bearer header. verify_session checks its signature, issuer and this
site's exact origin as audience, refuses a token without rh, and holds it to the
project's "who can sign in" rule. The site's own session then takes over."""

import logging
import sqlite3

import httpx
from fastapi import Request
from orangecheck import BondRequired, InvalidSession, Session, SignInPolicy, verify_session

from . import stand_in
from .config import cfg
from .db import db, now
from .sessions import ended_sessions

log = logging.getLogger("site")

# An outage is never "signed out": the page says try again.
UNAVAILABLE = {"revocations_unavailable", "key_set_unavailable", "bond_policy_unavailable"}

_policy: SignInPolicy | None = None


def _sign_in_policy() -> SignInPolicy:
    global _policy
    if _policy is None:
        _policy = SignInPolicy(cfg().project_key)
    return _policy


def bearer(request: Request) -> str:
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


class SignInNotConfigured(Exception):
    pass


def verify_sign_in_token(token: str) -> Session:
    """The verified token, or InvalidSession. Offline, the stand-in's key set is passed in:
    `issuer=` alone does not move where the SDK fetches keys from."""
    c = cfg()
    if c.mode == "offline":
        return verify_session(token, c.site_origin, jwks=stand_in.jwks(), issuer=stand_in.issuer())
    if not c.project_key:
        raise SignInNotConfigured()
    return verify_session(
        token,
        c.site_origin,
        revocations=ended_sessions(),
        policy=_sign_in_policy(),
        method="POST",
    )


def refusal(e: InvalidSession) -> tuple[int, dict]:
    """InvalidSession to an HTTP answer. The SDK leaves this mapping to you."""
    if e.reason in UNAVAILABLE:
        return 503, {"ok": False, "error": e.reason}
    if isinstance(e, BondRequired):
        return 403, {"ok": False, "error": "bond_required", "back_url": e.back_url}
    return 401, {"ok": False, "error": e.reason}


def spend_token(jti: str, exp: int) -> bool:
    """Spend a token: it starts one session, once, on any server that shares this table,
    until it expires. False when it was spent already."""
    db().execute("DELETE FROM spent_tokens WHERE exp < ?", (now(),))
    try:
        db().execute("INSERT INTO spent_tokens (jti, exp) VALUES (?, ?)", (jti, exp))
        return True
    except sqlite3.IntegrityError:
        return False


def end_token_at_orangecheck(token: str) -> None:
    """End the token at the auth host once the site's own session has taken over
    (ochk.io/docs/me/sdk#ending-a-session). Holding a token is the authority to end it."""
    if cfg().mode != "live" or not token:
        return
    try:
        httpx.post("https://ochk.io/api/auth/revoke", json={"tokens": [token]}, timeout=5)
    except httpx.HTTPError as e:
        # The token was spent here already; ending it at the host is belt and braces.
        log.warning("could not end the token at ochk.io: %s", e)
