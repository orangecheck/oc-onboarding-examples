"""The site: its own login, Connect behind it, claiming at ochk.app, and sign in with
orangecheck. Forms post and redirect; only the sign-in popup needs JavaScript.

Every route is a plain `def`, so FastAPI runs it in a thread: the SDK's calls are
synchronous and can wait on the network."""

import json
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import NamedTuple
from urllib.parse import quote

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from orangecheck import (
    CONNECT_CONSENT_BLURB,
    CONNECT_CONSENT_LABEL,
    InvalidWebhook,
    safe_return_path,
    verify_webhook,
)
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import connect, stand_in
from .config import assert_deployable, cfg, ended_sessions_checked, load_env_file
from .db import now
from .orangecheck_signin import (
    SignInNotConfigured,
    bearer,
    check_sign_in_token,
    end_token_at_orangecheck,
    spend_token,
)
from .passwords import DECOY, check_password, hash_password
from .sessions import (
    DAYS_30,
    FRESH_SECONDS,
    OcClaims,
    current_session,
    end_session,
    start_session,
)
from .users import (
    create_password_user,
    delete_user,
    link_did,
    linked_did,
    mark_connect_claimed,
    set_connect,
    tell_account,
    unlink_did,
    user_by_email,
    user_by_id,
    user_for_first_sign_in,
)

load_env_file()
HERE = Path(__file__).parent


@asynccontextmanager
async def lifespan(_: FastAPI):
    assert_deployable()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
templates = Jinja2Templates(directory=HERE / "templates")

# orangecheck's sign-in button, as base.html loads it (ochk.io/docs/integration/sign-in-button).
ME_CLIENT_CDN = "https://cdn.jsdelivr.net/npm/@orangecheck/me-client@0.48.0/dist/"
BUTTON_JS = ME_CLIENT_CDN + "button-auto.mjs"
BUTTON_CSS = ME_CLIENT_CDN + "button.css"

SENTENCES = {
    "bad_email": "Enter an email address.",
    "short_password": "Use at least 10 characters.",
    "email_taken": "An account already uses that address. Sign in instead.",
    "wrong_email_or_password": "That email and password don’t match.",
    "wrong_password": "That password is wrong.",
    "confirm_password_first": "Confirm your password first.",
    "not_ticked": "Tick the box first.",
    "has_orangecheck_already": "You sign in with orangecheck already.",
    "not_linked": "No orangecheck account is linked.",
    "revocations_unavailable": "orangecheck can’t be reached just now. Try again in a minute.",
    "connect_unavailable": "orangecheck can’t be reached just now, so nothing was deleted.",
    "unavailable": "orangecheck can’t be reached just now. Try again in a minute.",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    # same-origin would cut the popup off from this page; this keeps the opener link.
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # The two files base.html loads from jsDelivr, by exact path; their tags pin the
    # version and carry Subresource Integrity.
    response.headers["Content-Security-Policy"] = (
        f"default-src 'self'; script-src 'self' {BUTTON_JS}; style-src 'self' {BUTTON_CSS}; "
        "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
        "form-action 'self' https://ochk.app"
    )
    return response


# ---- guards ----


def same_origin(request: Request) -> None:
    """Every state change comes from this site's own pages. A browser sends
    Sec-Fetch-Site on every request and no page can set it; Origin is the fallback."""
    site = request.headers.get("sec-fetch-site")
    ok = (
        site == "same-origin"
        if site is not None
        else request.headers.get("origin") == (cfg().site_origin)
    )
    if not ok:
        raise HTTPException(403, "cross_site")


class Who(NamedTuple):
    session: sqlite3.Row
    user: sqlite3.Row


def signed_in(request: Request) -> Who | None | str:
    """The signed-in user, None, or "unavailable" while the list of ended sessions can't
    be read for a write (which is not "signed out")."""
    s = current_session(request)
    if s == "unavailable":
        return "unavailable"
    user = user_by_id(s["user_id"]) if s else None
    return Who(s, user) if s and user else None


def fresh_enough(who: Who) -> bool:
    """Linking, unlinking and deleting ask for a fresh sign-in with the site's own login,
    never one the did itself started. Someone with no login of their own shows a session
    minutes old."""
    s, user = who
    if s["via"] == "password":
        return s["fresh_until"] > now()
    return not user["password_hash"] and s["expires_at"] - DAYS_30 > now() - FRESH_SECONDS


def connect_for(user: sqlite3.Row, linked: str | None) -> bool:
    """Connect is for people who came in through the site's own login."""
    return bool(user["password_hash"]) and not linked


def back(path: str, error: str | None = None) -> RedirectResponse:
    return RedirectResponse(f"{path}?error={error}" if error else path, status_code=303)


def api_error(status: int, error: str, **extra) -> JSONResponse:
    return JSONResponse({"ok": False, "error": error, **extra}, status_code=status)


def page(request: Request, name: str, status_code: int = 200, **context):
    c = cfg()
    who = signed_in(request)
    context.setdefault("error", SENTENCES.get(request.query_params.get("error", "")))
    return templates.TemplateResponse(
        request,
        name,
        {
            "mode": c.mode,
            "ended_sessions_checked": ended_sessions_checked(c),
            "signed_in": isinstance(who, Who),
            "domain_verify": os.environ.get("OC_DOMAIN_VERIFY", "").strip(),
            **context,
        },
        status_code=status_code,
    )


# ---- pages ----


@app.get("/")
def home(request: Request):
    return page(request, "index.html")


@app.get("/signup")
def signup_page(request: Request):
    return page(
        request,
        "signup.html",
        connect=connect.connect_configured() and cfg().connect_mode,
        label=CONNECT_CONSENT_LABEL,
        blurb=CONNECT_CONSENT_BLURB,
    )


@app.get("/signin")
def signin_page(request: Request):
    return page(request, "signin.html")


@app.get("/reauth")
def reauth_page(request: Request, next: str | None = None):
    return page(request, "reauth.html", next=safe_return_path(next, "/account"))


@app.get("/account")
def account_page(request: Request):
    who = signed_in(request)
    if not isinstance(who, Who):
        return RedirectResponse("/signin", status_code=303)
    return account(request, who)


def account(request: Request, who: Who, claim_url: str | None = None, status_code: int = 200):
    user = who.user
    linked = linked_did(user["id"])
    show_connect = connect.connect_configured() and (
        connect_for(user, linked) or user["connect_did"]
    )
    return page(
        request,
        "account.html",
        status_code=status_code,
        user=user,
        linked=linked,
        fresh=fresh_enough(who),
        has_password=bool(user["password_hash"]),
        connect=show_connect,
        label=CONNECT_CONSENT_LABEL,
        blurb=CONNECT_CONSENT_BLURB,
        claim_url=claim_url,
    )


# ---- the site's own login ----


@app.post("/signup")
def signup(
    request: Request,
    email: str = Form(""),
    password: str = Form(""),
    orangecheck: str | None = Form(None),
):
    """Sign up. With Connect on, this is where the person gets an orangecheck account:
    always ("seamless"), or only when they ticked the box ("opt-in"). A refusal never
    blocks the sign-up."""
    same_origin(request)
    email = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return back("/signup", "bad_email")
    if len(password) < 10:
        return back("/signup", "short_password")
    if user_by_email(email):
        return back("/signup", "email_taken")
    user = create_password_user(email, hash_password(password))
    response = back("/account")
    start_session(response, user["id"], "password")
    if connect.connect_configured():
        seamless = cfg().connect_mode == "seamless"
        ticked = orangecheck == "on"
        # Unticked means no call at all; consent goes only with a tick.
        if seamless or ticked:
            consented = not seamless and ticked
            r = connect.provision(user["id"], consented)
            if r.ok:
                set_connect(user["id"], r.did_oc, consented)
    return response


@app.post("/signin")
def signin(request: Request, email: str = Form(""), password: str = Form("")):
    same_origin(request)
    user = user_by_email(email.strip().lower())
    ok = check_password(password, user["password_hash"] if user else DECOY)
    if not user or not ok:
        return back("/signin", "wrong_email_or_password")
    response = back("/account")
    start_session(response, user["id"], "password")
    return response


@app.post("/signout")
def signout(request: Request):
    same_origin(request)
    response = back("/")
    end_session(request, response)
    return response


@app.post("/reauth")
def reauth(request: Request, password: str = Form(""), next: str = Form("/account")):
    """A fresh sign-in with the site's own login: good for linking, unlinking and
    deleting for five minutes. Never one the did started."""
    same_origin(request)
    who = signed_in(request)
    if not isinstance(who, Who):
        return back("/signin")
    back_to = safe_return_path(next, "/account")
    if not who.user["password_hash"] or not check_password(password, who.user["password_hash"]):
        return RedirectResponse(f"/reauth?next={quote(back_to, safe='')}&error=wrong_password", 303)
    response = back(back_to)
    end_session(request, response)
    start_session(response, who.user["id"], "password", fresh=True)
    return response


# ---- Connect ----


@app.post("/connect/provision")
def provision(request: Request, orangecheck: str | None = Form(None)):
    """ "Also create my orangecheck account", ticked on the account page. A tick is
    consent, recorded once; it also upgrades an account made without asking."""
    same_origin(request)
    who = signed_in(request)
    if not isinstance(who, Who):
        return back("/signin")
    if not connect_for(who.user, linked_did(who.user["id"])):
        return back("/account", "has_orangecheck_already")
    if orangecheck != "on":
        return back("/account", "not_ticked")
    r = connect.provision(who.user["id"], True)
    if not r.ok:
        return back("/account", "unavailable")
    set_connect(who.user["id"], r.did_oc, True)
    return back("/account")


@app.post("/connect/claim-link")
def claim_link(request: Request):
    """A claim link, minted for the signed-in user only, at the moment they ask. It works
    once, for fifteen minutes; the browser goes straight to it."""
    same_origin(request)
    who = signed_in(request)
    if not isinstance(who, Who):
        return back("/signin")
    if not who.user["connect_did"]:
        return back("/account")
    r = connect.claim_link(who.user["id"])
    if not r.ok:
        return back("/account", "unavailable")
    return RedirectResponse(r.url, status_code=303)


# ---- sign in with orangecheck ----


def _token_or_refusal(request: Request):
    try:
        checked = check_sign_in_token(request)
    except SignInNotConfigured:
        return api_error(503, "sign_in_not_configured")
    if not checked.ok:
        return JSONResponse(checked.body, status_code=checked.status)
    return checked.session


@app.post("/api/auth/orangecheck")
def sign_in_with_orangecheck(request: Request):
    same_origin(request)
    s = _token_or_refusal(request)
    if isinstance(s, Response):
        return s
    # check_oc_session refused a token without rh (require_handle is on by default).
    rh = s.rh
    if not s.iat or not spend_token(s.jti, s.exp):
        return api_error(401, "token_spent")
    user = user_for_first_sign_in(s.did_oc)
    response = JSONResponse({"ok": True})
    start_session(
        response, user["id"], "orangecheck", OcClaims(s.did_oc, rh, cfg().site_origin, s.iat)
    )
    end_token_at_orangecheck(bearer(request), s.exp)
    return response


@app.post("/api/account/link")
def link(request: Request):
    """Link orangecheck to an account that has its own login, after a fresh sign-in with
    that login. One did per account; a did another user has is refused."""
    same_origin(request)
    who = signed_in(request)
    if who == "unavailable":
        return api_error(503, "revocations_unavailable")
    if who is None:
        return api_error(401, "signed_out")
    if not who.user["password_hash"] or not fresh_enough(who):
        return api_error(403, "confirm_password_first")
    s = _token_or_refusal(request)
    if isinstance(s, Response):
        return s
    if not spend_token(s.jti, s.exp):
        return api_error(401, "token_spent")
    result = link_did(who.user["id"], s.did_oc)
    end_token_at_orangecheck(bearer(request), s.exp)
    if result != "linked":
        return api_error(409, result)
    tell_account(who.user, f"orangecheck {s.did_oc} was linked to your account.")
    return JSONResponse({"ok": True, "did_oc": s.did_oc})


@app.post("/account/unlink")
def unlink(request: Request):
    """Unlink after a fresh sign-in with the site's own login. Every session the did
    started here ends with it."""
    same_origin(request)
    who = signed_in(request)
    if who == "unavailable":
        return back("/account", "revocations_unavailable")
    if who is None:
        return back("/signin")
    if not who.user["password_hash"] or not fresh_enough(who):
        return back("/account", "confirm_password_first")
    did = unlink_did(who.user["id"])
    if not did:
        return back("/account", "not_linked")
    tell_account(who.user, f"orangecheck {did} was unlinked from your account.")
    return back("/account")


@app.post("/account/delete")
def delete_account(request: Request):
    """Delete the account. The orangecheck account Connect made goes first
    (ochk.io/docs/connect): unclaimed, it is deleted; claimed, it is theirs and only
    detaches. One that earned stays, and the person gets a claim link before they go."""
    same_origin(request)
    who = signed_in(request)
    if who == "unavailable":
        return back("/account", "revocations_unavailable")
    if who is None:
        return back("/signin")
    if not fresh_enough(who):
        return back("/account", "confirm_password_first")
    if who.user["connect_did"]:
        r = connect.delete(who.user["id"])
        if not r.ok:
            if r.reason == "holds_earnings":
                link = connect.claim_link(who.user["id"])
                return account(request, who, claim_url=link.url if link.ok else "", status_code=409)
            # Not deleted there, so not here either: never leave an account nobody can reach.
            return back("/account", "connect_unavailable")
    delete_user(who.user["id"])
    response = back("/")
    end_session(request, response)
    return response


# ---- webhooks ----


@app.post("/api/webhooks/orangecheck")
async def webhook(request: Request):
    """Your project's webhooks (ochk.io/docs/me/webhooks). The one this site acts on is
    connect.claimed. The signature is over the raw bytes. A system event like this one
    carries no "id" in its body; its id is the OC-Envelope-Id header."""
    if cfg().mode != "live":
        return api_error(404, "not_found")
    raw = await request.body()
    try:
        # verify_webhook may fetch keys (up to 10 s): keep it off the event loop.
        event = await run_in_threadpool(verify_webhook, request.headers, raw)
    except InvalidWebhook as e:
        return api_error(401, e.reason)
    if event.get("subtype") == "connect.claimed" and event.get("did_oc"):
        mark_connect_claimed(event["did_oc"])
    return JSONResponse({"ok": True})


# ---- offline stand-ins ----


def _offline_only() -> None:
    if cfg().mode != "offline":
        raise HTTPException(404, "not_found")


@app.get("/stand-in/.well-known/jwks.json")
def stand_in_jwks():
    _offline_only()
    return stand_in.jwks()


@app.get("/stand-in/popup")
def stand_in_popup(request: Request, opener_origin: str = ""):
    """Stands in for me.ochk.io/popup/signin: it answers its opener as the real popup
    does, with {type: 'oc-signin-success', account, token}, to the opener's origin only."""
    _offline_only()
    return page(
        request,
        "stand_in_popup.html",
        opener=opener_origin,
        allowed=opener_origin == cfg().site_origin,
    )


@app.post("/stand-in/token")
async def stand_in_token(request: Request):
    _offline_only()
    same_origin(request)
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        body = {}
    name = str(body.get("name", "")).strip()[:40] if isinstance(body, dict) else ""
    if not name:
        return api_error(400, "name_required")
    return JSONResponse({"ok": True, **stand_in.token(name)})


@app.get("/stand-in/claim")
def stand_in_claim_page(request: Request):
    _offline_only()
    return page(request, "stand_in_claim.html", state="ready")


@app.post("/stand-in/claim")
def stand_in_claim(request: Request, t: str = Form("")):
    """What ochk.app does when the person confirms a claim."""
    _offline_only()
    same_origin(request)
    ok = stand_in.claim(t)
    return page(
        request,
        "stand_in_claim.html",
        state="claimed" if ok else "failed",
        status_code=200 if ok else 410,
    )


@app.exception_handler(StarletteHTTPException)
def http_error(_: Request, exc: StarletteHTTPException):
    return api_error(exc.status_code, str(exc.detail))
