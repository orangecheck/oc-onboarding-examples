"""Sign in with orangecheck (ochk.io/docs/me/quickstart). The page sends the popup's
token once, as a Bearer header. check_oc_session checks its signature, issuer and this
site's exact origin as audience, refuses a token without rh, holds it to the project's
"who can sign in" rule, and gives the HTTP answer for any refusal. The site's own
session then takes over."""

import logging

from fastapi import Request
from orangecheck import SessionCheck, SignInPolicy, check_oc_session, revoke_token, spend_once

from . import stand_in
from .config import cfg
from .db import db, now
from .sessions import ended_sessions

log = logging.getLogger("site")

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


def check_sign_in_token(request: Request) -> SessionCheck:
    """The request's token, checked. Offline, the stand-in's key set is passed in."""
    c = cfg()
    if c.mode == "offline":
        return check_oc_session(
            bearer(request), c.site_origin, jwks=stand_in.jwks(), issuer=stand_in.issuer()
        )
    if not c.project_key:
        raise SignInNotConfigured()
    return check_oc_session(
        bearer(request),
        c.site_origin,
        revocations=ended_sessions(),
        policy=_sign_in_policy(),
        method="POST",
    )


class SpentTokens:
    """Every server that accepts sign-ins shares this table, so a token starts one
    session, once, until it expires."""

    def add(self, jti: str, exp: int) -> bool:
        db().execute("DELETE FROM spent_tokens WHERE exp <= ?", (now(),))
        cur = db().execute(
            "INSERT OR IGNORE INTO spent_tokens (jti, exp) VALUES (?, ?)", (jti, exp)
        )
        return cur.rowcount == 1


def spend_token(jti: str, exp: int) -> bool:
    """False when the token was spent already, or has expired."""
    return spend_once(jti, exp, SpentTokens())


def end_token_at_orangecheck(token: str, exp: int) -> None:
    """End the token at the auth host once the site's own session has taken over
    (ochk.io/docs/me/sdk#ending-a-session). A token ochk.io couldn't take right now waits
    in unended_tokens until the next sign-in sends it again, or until it expires."""
    if cfg().mode != "live":
        return
    db().execute("DELETE FROM unended_tokens WHERE exp <= ?", (now(),))
    waiting = [r[0] for r in db().execute("SELECT token FROM unended_tokens LIMIT 7")]
    result = revoke_token([token, *waiting])
    if result.ok or result.reason == "bad_request":
        db().executemany("DELETE FROM unended_tokens WHERE token = ?", [(t,) for t in waiting])
        if not result.ok:
            log.warning("ochk.io refused to end the tokens (400)")
        return
    db().execute("INSERT OR IGNORE INTO unended_tokens (token, exp) VALUES (?, ?)", (token, exp))
    log.warning("could not end the token at ochk.io (%s); queued", result.reason)
