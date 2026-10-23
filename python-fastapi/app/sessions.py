"""The site's own sessions. A sign-in with orangecheck starts one and the token is
spent: what it leaves behind is its rh, aud and iat, so the session ends when the
person ends every session (ochk.io/docs/me/sdk)."""

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass

from fastapi import Request, Response
from orangecheck import RevocationList

from .config import cfg, ended_sessions_checked
from .db import db, now

COOKIE = "site_session"
DAYS_30 = 30 * 24 * 3600
FRESH_SECONDS = 5 * 60
SAFE = {"GET", "HEAD", "OPTIONS"}


@dataclass(frozen=True)
class OcClaims:
    did_oc: str
    rh: str
    aud: str  # this site's origin, from config, never the token's own aud
    iat: int


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _set_cookie(response: Response, value: str, max_age: int) -> None:
    response.set_cookie(
        COOKIE,
        value,
        max_age=max_age,
        path="/",
        httponly=True,
        samesite="lax",
        secure=cfg().site_origin.startswith("https://"),
    )


def start_session(
    response: Response, user_id: str, via: str, oc: OcClaims | None = None, fresh: bool = False
) -> None:
    """Start a session; an orangecheck one carries the token's handle with it."""
    sid = secrets.token_urlsafe(32)
    db().execute(
        "INSERT INTO sessions"
        " (id_hash, user_id, via, did_oc, rh, aud, iat, fresh_until, expires_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            _hash(sid),
            user_id,
            via,
            oc.did_oc if oc else None,
            oc.rh if oc else None,
            oc.aud if oc else None,
            oc.iat if oc else None,
            now() + FRESH_SECONDS if fresh else 0,
            now() + DAYS_30,
        ),
    )
    _set_cookie(response, sid, DAYS_30)


def end_session(request: Request, response: Response) -> None:
    sid = request.cookies.get(COOKIE)
    if sid:
        db().execute("DELETE FROM sessions WHERE id_hash = ?", (_hash(sid),))
    _set_cookie(response, "", 0)


_ended: RevocationList | None = None
_ended_for_tests: object | None = None


def ended_sessions():
    """One list of ended sessions per process, from OC_PROJECT_KEY and OC_SIGNING_SECRET."""
    global _ended
    if _ended_for_tests is not None:
        return _ended_for_tests
    if not ended_sessions_checked():
        return None
    if _ended is None:
        c = cfg()
        _ended = RevocationList(c.project_key, c.signing_secret)
    return _ended


def set_ended_sessions_for_tests(check: object | None) -> None:
    """Tests: hand in an object with status(rh, aud, iat) for the next requests to use."""
    global _ended_for_tests, _ended
    _ended_for_tests = check
    _ended = None


def current_session(request: Request) -> sqlite3.Row | None | str:
    """The request's session, None, or "unavailable". An orangecheck session is asked
    about on every request: ended everywhere means signed out here too; while the list
    can't be read, reads go on and writes answer "unavailable" (never "signed out", so
    the page retries instead of sending the person to sign in)."""
    sid = request.cookies.get(COOKIE)
    if not sid:
        return None
    s = (
        db()
        .execute("SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?", (_hash(sid), now()))
        .fetchone()
    )
    if not s:
        return None
    if s["via"] != "orangecheck":
        return s
    check = ended_sessions()
    if check is None:
        return s
    status = check.status(s["rh"], s["aud"], s["iat"])
    if status == "revoked":
        db().execute("DELETE FROM sessions WHERE id_hash = ?", (s["id_hash"],))
        return None
    if status == "unverified" and request.method not in SAFE:
        return "unavailable"
    return s
