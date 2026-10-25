"""Each test checks a rule from the quickstart's checklist (ochk.io/docs/me/quickstart)
or the Connect docs (ochk.io/docs/connect), through the site's real routes."""

import re
import time
from types import SimpleNamespace

import pytest
from orangecheck import RevocationList

from app import db, orangecheck_signin, sessions, stand_in
from app.config import assert_deployable

from .conftest import ORIGIN, PASSWORD, bearer, browser, did, reauthed, signed_up, token, users

PROVISION = "https://ochk.io/api/connect/provision"


def stand_in_rows() -> list[dict]:
    return [dict(r) for r in db.db().execute("SELECT * FROM stand_in_connect")]


def claim_token(b) -> str:
    r = b.post("/connect/claim-link")
    assert r.status_code == 303
    return r.headers["location"].split("#t=")[1]


# ---- the site's own login, with Connect ----


def test_signs_in_with_the_right_password_only():
    signed_up()
    wrong = browser().post("/signin", data={"email": "ada@example.com", "password": "nope nope"})
    assert wrong.headers["location"] == "/signin?error=wrong_email_or_password"
    right = browser().post("/signin", data={"email": "ada@example.com", "password": PASSWORD})
    assert right.headers["location"] == "/account"


def test_an_email_is_the_same_address_in_any_case_and_any_surrounding_space():
    signed_up(" Ada@Example.COM ")
    # U+FEFF is space to JavaScript's trim (and so to orangecheck), not to str.strip().
    for email in ["ada@example.com", "\ufeffADA@example.com", "ada@EXAMPLE.com\t"]:
        r = browser().post("/signin", data={"email": email, "password": PASSWORD})
        assert r.headers["location"] == "/account", email


def test_opt_in_unticked_makes_no_orangecheck_account():
    signed_up(orangecheck=False)
    assert users()[0]["connect_did"] is None


def test_opt_in_a_tick_makes_one_with_consent_recorded():
    signed_up(orangecheck=True)
    assert users()[0]["connect_consent"] == 1
    assert users()[0]["connect_did"].startswith("did:oc:")


def test_seamless_every_sign_up_gets_one_identity_only(monkeypatch):
    monkeypatch.setenv("CONNECT_MODE", "seamless")
    signed_up(orangecheck=False)
    assert users()[0]["connect_consent"] == 0 and users()[0]["connect_did"]
    assert stand_in_rows()[0]["consent"] == 0


def test_a_claim_link_is_for_the_signed_in_user_and_works_once():
    assert browser().post("/connect/claim-link").headers["location"] == "/signin"
    b = signed_up(orangecheck=True)
    t = claim_token(b)
    assert b.post("/stand-in/claim", data={"t": t}).status_code == 200
    assert users()[0]["connect_claimed"] == 1
    assert b.post("/stand-in/claim", data={"t": t}).status_code == 410


def test_no_claim_link_without_an_account_to_claim():
    b = signed_up(orangecheck=False)
    assert b.post("/connect/claim-link").headers["location"] == "/account"


def test_a_claim_link_stops_working_once_the_account_is_deleted():
    b = signed_up(orangecheck=True)
    t = claim_token(b)
    reauthed(b)
    assert b.post("/account/delete").headers["location"] == "/"
    assert browser().post("/stand-in/claim", data={"t": t}).status_code == 410


def test_a_later_tick_upgrades_a_seamless_account_to_consented(monkeypatch):
    monkeypatch.setenv("CONNECT_MODE", "seamless")
    b = signed_up()
    before = users()[0]["connect_did"]
    assert (
        b.post("/connect/provision", data={"orangecheck": "on"}).headers["location"] == "/account"
    )
    assert users()[0]["connect_did"] == before and users()[0]["connect_consent"] == 1


# ---- Connect, live: what this site sends ochk.io ----


def live_signup(monkeypatch, net, orangecheck: bool) -> list:
    monkeypatch.setenv("OCHK_CONNECT_KEY", "occ_sk_test")
    net.routes[PROVISION] = (200, {"ok": True, "did_oc": did("c"), "is_new": True})
    signed_up(orangecheck=orangecheck)
    return [c["body"] for c in net.calls if c["url"] == PROVISION]


def test_live_opt_in_unticked_makes_no_call(monkeypatch, net):
    assert live_signup(monkeypatch, net, False) == []


def test_live_opt_in_ticked_sends_consent(monkeypatch, net):
    assert live_signup(monkeypatch, net, True) == [{"user_id": users()[0]["id"], "consent": True}]


def test_live_seamless_never_claims_a_consent_nobody_gave(monkeypatch, net):
    monkeypatch.setenv("CONNECT_MODE", "seamless")
    assert live_signup(monkeypatch, net, False) == [{"user_id": users()[0]["id"]}]


# ---- sign in with orangecheck ----


def test_a_first_sign_in_creates_a_user_and_the_same_did_returns_to_it():
    assert browser().post("/api/auth/orangecheck", headers=bearer(did("a"))).status_code == 200
    assert browser().post("/api/auth/orangecheck", headers=bearer(did("a"))).status_code == 200
    assert len(users()) == 1
    assert users()[0]["email"] is None and users()[0]["password_hash"] is None


def test_a_token_starts_one_session_once():
    headers = bearer(did("a"))
    assert browser().post("/api/auth/orangecheck", headers=headers).status_code == 200
    again = browser().post("/api/auth/orangecheck", headers=headers)
    assert again.status_code == 401 and again.json()["error"] == "token_spent"


def test_a_token_without_rh_is_refused_and_starts_nothing():
    r = browser().post("/api/auth/orangecheck", headers=bearer(did("a"), rh=None))
    assert r.status_code == 401 and r.json()["reason"] == "no_session_handle"
    assert "site_session" not in r.cookies
    assert users() == []


def test_a_token_issued_to_another_site_is_refused():
    r = browser().post(
        "/api/auth/orangecheck", headers=bearer(did("a"), aud="https://other.example")
    )
    assert r.status_code == 401 and r.json()["reason"] == "unauthenticated"
    assert users() == []


def test_a_cross_site_request_is_refused_before_anything_is_read():
    b = browser()
    r = b.post(
        "/api/auth/orangecheck", headers={**bearer(did("a")), "sec-fetch-site": "cross-site"}
    )
    assert r.status_code == 403 and r.json()["error"] == "cross_site"


def test_the_stand_in_issues_tokens_offline_only(monkeypatch):
    assert browser().post("/stand-in/token", json={"name": "Ada"}).status_code == 200
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_test_x")
    assert browser().post("/stand-in/token", json={"name": "Ada"}).status_code == 404


def test_offline_nothing_goes_to_ochk_io(net):
    assert browser().post("/api/auth/orangecheck", headers=bearer(did("a"))).status_code == 200
    assert net.calls == []


# ---- sign in with orangecheck, live ----

REVOKE = "https://ochk.io/api/auth/revoke"
RULE = "https://me.ochk.io/api/integrator/pk_test_example/sign-in"


@pytest.fixture
def live(monkeypatch, net):
    """Live mode. Only the keys are the stand-in's: everything else is passed as live mode
    passes it, the project's rule included."""
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_test_example")
    monkeypatch.setattr(orangecheck_signin, "_policy", None)
    real = orangecheck_signin.check_oc_session
    seen: dict = {}

    def check(t, audience, **kwargs):
        seen.update(kwargs)
        return real(t, audience, jwks=stand_in.jwks(), issuer=stand_in.issuer(), **kwargs)

    monkeypatch.setattr(orangecheck_signin, "check_oc_session", check)
    net.get_routes[RULE] = (200, {"ok": True, "require_bond": None})
    net.routes[REVOKE] = (200, {"ok": True, "revoked": 1})
    return SimpleNamespace(net=net, seen=seen)


def live_sign_in(d: str, status: int = 200) -> str:
    t = token(d)
    r = browser().post("/api/auth/orangecheck", headers={"authorization": f"Bearer {t}"})
    assert r.status_code == status, r.text
    return t


def sent(net) -> list[list[str]]:
    return [c["body"]["tokens"] for c in net.calls if c["url"] == REVOKE]


def waiting() -> list[str]:
    return [r[0] for r in db.db().execute("SELECT token FROM unended_tokens")]


def test_live_a_sign_in_is_held_to_the_rule_and_ends_its_token(live):
    t = live_sign_in(did("a"))
    assert live.seen["method"] == "POST" and live.seen["policy"] is not None
    assert sent(live.net) == [[t]] and waiting() == []


@pytest.mark.parametrize("status", [503, 429])
def test_live_a_token_ochk_io_couldnt_take_goes_with_the_next_sign_in(live, status):
    live.net.routes[REVOKE] = (status, {})
    first = live_sign_in(did("a"))
    assert waiting() == [first]
    live.net.routes[REVOKE] = (200, {"ok": True, "revoked": 2})
    second = live_sign_in(did("b"))
    assert sent(live.net) == [[first], [second, first]] and waiting() == []


def test_live_a_refused_call_leaves_nothing_waiting(live):
    live.net.routes[REVOKE] = (503, {})
    live_sign_in(did("a"))
    live.net.routes[REVOKE] = (400, {})
    live_sign_in(did("b"))
    assert waiting() == []


def test_live_an_expired_token_is_not_sent_again(live):
    db.db().execute(
        "INSERT INTO unended_tokens (token, exp) VALUES (?, ?)", ("old", int(time.time()))
    )
    t = live_sign_in(did("a"))
    assert sent(live.net) == [[t]] and waiting() == []


def test_live_an_outage_is_never_signed_out(live):
    sessions.set_ended_sessions_for_tests(EndedList("unverified"))
    t = token(did("a"))
    r = browser().post("/api/auth/orangecheck", headers={"authorization": f"Bearer {t}"})
    assert r.status_code == 503 and r.json()["reason"] == "revocations_unavailable"
    assert users() == []


def test_live_an_unbacked_account_is_sent_to_back_it(live):
    live.net.get_routes[RULE] = (200, {"ok": True, "require_bond": {"min_sats": 1, "min_days": 1}})
    t = token(did("a"))
    r = browser().post("/api/auth/orangecheck", headers={"authorization": f"Bearer {t}"})
    assert r.status_code == 403 and r.json()["back_url"].startswith("https://ochk.app/")
    assert users() == []


# ---- linking orangecheck to an account with its own login ----


def test_linking_asks_for_the_password_first_then_links_one_did():
    b = signed_up()
    assert b.post("/api/account/link", headers=bearer(did("a"))).json()["error"] == (
        "confirm_password_first"
    )
    reauthed(b)
    assert b.post("/api/account/link", headers=bearer(did("a"))).status_code == 200
    again = b.post("/api/account/link", headers=bearer(did("b")))
    assert again.json()["error"] == "already_linked"


def test_linking_refuses_a_did_another_user_has():
    browser().post("/api/auth/orangecheck", headers=bearer(did("a")))
    b = reauthed(signed_up())
    assert b.post("/api/account/link", headers=bearer(did("a"))).json()["error"] == "did_taken"


def test_a_token_spent_on_a_sign_in_cant_link():
    headers = bearer(did("a"))
    browser().post("/api/auth/orangecheck", headers=headers)
    b = reauthed(signed_up())
    assert b.post("/api/account/link", headers=headers).json()["error"] == "token_spent"


def test_a_session_the_did_started_cant_stand_in_for_the_password():
    b = reauthed(signed_up())
    b.post("/api/account/link", headers=bearer(did("a")))
    via_oc = browser()
    via_oc.post("/api/auth/orangecheck", headers=bearer(did("a")))
    r = via_oc.post("/account/unlink")
    assert r.headers["location"] == "/account?error=confirm_password_first"


def test_unlinking_ends_every_session_that_did_started_here():
    b = reauthed(signed_up())
    b.post("/api/account/link", headers=bearer(did("a")))
    via_oc = browser()
    via_oc.post("/api/auth/orangecheck", headers=bearer(did("a")))
    assert b.post("/account/unlink").headers["location"] == "/account"
    assert via_oc.get("/account").headers["location"] == "/signin"


# ---- ending every session ----


class EndedList:
    def __init__(self, answer: str):
        self.answer = answer

    def status(self, rh, aud, iat):
        assert aud == ORIGIN and rh and iat  # the session's own handle, this site's origin
        return self.answer

    def status_for(self, claims):  # what verify_session asks, for the token itself
        return self.answer


def orangecheck_session():
    b = browser()
    b.post("/api/auth/orangecheck", headers=bearer(did("a")))
    return b


def test_on_localhost_both_keys_check_ended_sessions(monkeypatch):
    # A test project's declared development origin makes the list readable for localhost.
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_test_x")
    assert sessions.ended_sessions() is None  # no secret: nothing to read it with
    monkeypatch.setenv("OC_SIGNING_SECRET", "secret")
    assert isinstance(sessions.ended_sessions(), RevocationList)  # localhost is no exemption


def test_a_session_ended_everywhere_is_signed_out_here():
    b = orangecheck_session()
    sessions.set_ended_sessions_for_tests(EndedList("revoked"))
    assert b.get("/account").headers["location"] == "/signin"


def test_while_the_list_cant_be_read_reads_go_on_and_writes_wait():
    b = orangecheck_session()
    sessions.set_ended_sessions_for_tests(EndedList("unverified"))
    assert b.get("/account").status_code == 200
    r = b.post("/account/delete")
    assert r.headers["location"] == "/account?error=revocations_unavailable"
    assert len(users()) == 1


# ---- deleting an account ----


def test_deleting_removes_the_connect_account_then_the_user():
    b = reauthed(signed_up(orangecheck=True))
    assert b.post("/account/delete").headers["location"] == "/"
    assert users() == []
    assert stand_in_rows()[0]["deleted"] == 1


def test_live_an_account_that_earned_stays_and_its_person_gets_a_claim_link(monkeypatch, net):
    b = reauthed(signed_up(orangecheck=True))
    monkeypatch.setenv("OCHK_CONNECT_KEY", "occ_sk_test")
    net.routes["https://ochk.io/api/connect/delete"] = (
        409,
        {"ok": False, "reason": "holds_earnings"},
    )
    net.routes["https://ochk.io/api/connect/claim-link"] = (
        200,
        {
            "ok": True,
            "url": "https://ochk.app/connect/claim#t=abc",
            "expires_at": "2026-10-24T00:00:00Z",
        },
    )
    r = b.post("/account/delete")
    assert r.status_code == 409
    assert 'href="https://ochk.app/connect/claim#t=abc"' in r.text
    assert len(users()) == 1


def test_live_while_ochk_io_cant_be_reached_nothing_is_deleted_here(monkeypatch, net):
    b = reauthed(signed_up(orangecheck=True))
    monkeypatch.setenv("OCHK_CONNECT_KEY", "occ_sk_test")
    net.routes["https://ochk.io/api/connect/delete"] = (502, {})
    assert b.post("/account/delete").headers["location"] == "/account?error=connect_unavailable"
    assert len(users()) == 1


# ---- webhooks, pages, deployment ----


def test_a_webhook_without_a_signature_is_refused_and_offline_there_is_none(monkeypatch):
    assert browser().post("/api/webhooks/orangecheck", content=b"{}").status_code == 404
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_test_x")
    r = browser().post("/api/webhooks/orangecheck", content=b"{}")
    assert r.status_code == 401 and r.json()["error"] == "missing"


def test_connect_claimed_marks_the_account_claimed(monkeypatch):
    signed_up(orangecheck=True)
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_test_x")
    claimed = users()[0]["connect_did"]
    # The signature check is the SDK's; this is what the site does with a verified event.
    monkeypatch.setattr(
        "app.main.verify_webhook", lambda h, b: {"subtype": "connect.claimed", "did_oc": claimed}
    )
    assert browser().post("/api/webhooks/orangecheck", content=b"{}").status_code == 200
    assert users()[0]["connect_claimed"] == 1


def test_the_domain_token_is_in_the_html_the_check_reads(monkeypatch):
    assert "oc-domain-verify" not in browser().get("/").text
    monkeypatch.setenv("OC_DOMAIN_VERIFY", "tok_123")
    assert '<meta name="oc-domain-verify" content="tok_123" />' in browser().get("/").text


def test_the_orangecheck_button_keeps_its_mark_and_says_orangecheck(monkeypatch):
    b = reauthed(signed_up())
    pages = {"sign-in": browser().get("/signin").text, "link": b.get("/account").text}
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_test_example")
    pages["sign-in, live"] = browser().get("/signin").text
    for name, html in pages.items():
        buttons = re.findall(r"<button\b([^>]*\bdata-oc-sign-in\b[^>]*)>(.*?)</button>", html, re.S)
        assert len(buttons) == 1, name
        attributes, inside = buttons[0]
        assert 'class="oc"' in attributes, name
        # The placeholder the SDK draws the mark into, first; then the words.
        words = re.fullmatch(r"\s*<span data-oc-mark></span>([^<]+)", inside)
        assert words, (name, inside)
        assert re.search(r"(^|\W)orangecheck(\W|$)", words[1].strip()), (name, words[1])


def test_pages_load_the_button_pinned_and_checked_and_their_own_script_from_this_site(
    monkeypatch,
):
    offline = browser().get("/signin")
    assert "button-auto.mjs" not in offline.text
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_test_example")
    r = browser().get("/signin")
    assert r.headers["cross-origin-opener-policy"] == "same-origin-allow-popups"
    csp = r.headers["content-security-policy"]
    tags = re.findall(
        r'<(?:script|link)\b[^>]*?(?:src|href)="(https://[^"]+)"\s+integrity="(sha384-[^"]+)"'
        r'\s+crossorigin="anonymous"',
        r.text,
    )
    assert [url.rsplit("/", 1)[1] for url, _ in tags] == ["button.css", "button-auto.mjs"]
    for url, _ in tags:
        assert url in csp
    # The copy offline mode loads is the same version as the tags.
    version = re.search(r"/me-client@([\d.]+)/", tags[0][0])[1]
    copy = browser().get("/static/button.mjs")
    assert copy.text.startswith(f"// @orangecheck/me-client {version} dist/button.mjs")
    js = browser().get("/static/orangecheck.mjs")
    assert js.headers["content-type"].startswith("text/javascript")


def test_a_deployment_refuses_to_start_without_its_origin_and_both_keys(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SITE_ORIGIN", "https://example.com")
    with pytest.raises(RuntimeError, match="without OC_PROJECT_KEY, OC_SIGNING_SECRET"):
        assert_deployable()
    monkeypatch.setenv("OC_PROJECT_KEY", "pk_live_x")
    with pytest.raises(RuntimeError, match="without OC_SIGNING_SECRET"):
        assert_deployable()
    monkeypatch.setenv("OC_SIGNING_SECRET", "secret")
    assert_deployable()
    monkeypatch.setenv("SITE_ORIGIN", "http://example.com")
    with pytest.raises(RuntimeError, match="must be https"):
        assert_deployable()
    monkeypatch.delenv("SITE_ORIGIN")
    with pytest.raises(RuntimeError, match="without SITE_ORIGIN"):
        assert_deployable()
