"""Calls the site's real routes with a real database (in memory), in offline mode
unless a test says otherwise. Nothing reaches the network: httpx is stubbed, and a
request no test routed fails it."""

import json as jsonlib
import os
import time
import uuid
from types import SimpleNamespace

os.environ["DB_PATH"] = ":memory:"

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db, main, sessions, stand_in  # noqa: E402

ORIGIN = "http://localhost:8000"
PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def offline_site(monkeypatch):
    for key in ("OC_PROJECT_KEY", "OC_SIGNING_SECRET", "OCHK_CONNECT_KEY", "CONNECT_MODE", "PORT"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("SITE_ORIGIN", ORIGIN)
    monkeypatch.setenv("DB_PATH", ":memory:")
    db.reset_db_for_tests()
    stand_in.reset_for_tests()
    sessions.set_ended_sessions_for_tests(None)
    yield


@pytest.fixture(autouse=True)
def net(monkeypatch):
    """Routes for httpx.post and httpx.get by URL. Anything else fails the test."""
    calls: list[dict] = []
    routes: dict = {}
    get_routes: dict = {}

    def post(url, *args, json=None, content=None, **kwargs):
        body = json if json is not None else (jsonlib.loads(content) if content else None)
        calls.append({"url": url, "body": body})
        if url in routes:
            status, answer = routes[url]
            return httpx.Response(status, json=answer, request=httpx.Request("POST", url))
        raise AssertionError(f"unexpected POST {url}")

    def get(url, *args, **kwargs):
        if url in get_routes:
            status, answer = get_routes[url]
            return httpx.Response(status, json=answer, request=httpx.Request("GET", url))
        raise AssertionError(f"unexpected GET {url}")

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "get", get)
    return SimpleNamespace(calls=calls, routes=routes, get_routes=get_routes)


def browser() -> TestClient:
    """A browser: keeps the session cookie between calls, says same-origin, doesn't follow
    redirects (the tests read where each one goes)."""
    return TestClient(main.app, headers={"sec-fetch-site": "same-origin"}, follow_redirects=False)


def did(c: str) -> str:
    return "did:oc:" + (c * 32)[:32]


def token(d: str, *, aud=None, rh="handle", iss=None) -> str:
    """A sign-in token as ochk.io issues one: bound to this site, with a revocation handle."""
    t = int(time.time())
    claims = {
        "iss": iss or f"{ORIGIN}/stand-in",
        "aud": aud or ORIGIN,
        "sub": "sub-" + d[-6:],
        "did_oc": d,
        "rh": rh,
        "jti": str(uuid.uuid4()),
        "iat": t,
        "exp": t + 3600,
    }
    return stand_in.sign({k: v for k, v in claims.items() if v is not None})


def bearer(d: str, **kwargs) -> dict:
    return {"authorization": f"Bearer {token(d, **kwargs)}"}


def users() -> list[dict]:
    return [dict(r) for r in db.db().execute("SELECT * FROM users")]


def signed_up(email="ada@example.com", orangecheck=False) -> TestClient:
    b = browser()
    form = {"email": email, "password": PASSWORD}
    if orangecheck:
        form["orangecheck"] = "on"
    r = b.post("/signup", data=form)
    assert r.status_code == 303 and r.headers["location"] == "/account", r.text
    return b


def reauthed(b: TestClient) -> TestClient:
    r = b.post("/reauth", data={"password": PASSWORD, "next": "/account"})
    assert r.headers["location"] == "/account"
    return b
