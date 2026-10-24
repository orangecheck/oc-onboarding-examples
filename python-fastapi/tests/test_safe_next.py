"""The return path after a fresh sign-in never leaves the site."""

import pytest

from app.safe_next import safe_next

from .conftest import PASSWORD, signed_up

# Every one of these leaves the site once a browser has read it.
REFUSED = [
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r//evil.com",
    "//1249741522",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/..//evil.com",
    "/%2e%2e//evil.com",
    "/%2E./evil.com",
    "/a/../account",
    "/./account",
    "/\x00/evil.com",
    "/\x7f/evil.com",
    "evil.com",
    "",
]


@pytest.mark.parametrize("raw", REFUSED)
def test_refuses_a_path_off_the_site(raw):
    assert safe_next(raw) == "/account"


def test_keeps_a_path_on_this_site():
    assert safe_next("/account") == "/account"
    assert safe_next("/account/delete?step=2#confirm") == "/account/delete?step=2#confirm"
    assert safe_next("/account?from=/a/../b") == "/account?from=/a/../b"


@pytest.mark.parametrize("raw", [None, 42, ["/account"]])
def test_answers_the_fallback_for_anything_that_is_not_text(raw):
    assert safe_next(raw) == "/account"


def test_the_reauth_route_sends_an_off_site_next_home():
    b = signed_up()
    r = b.post("/reauth", data={"password": PASSWORD, "next": "//1249741522"})
    assert (r.status_code, r.headers["location"]) == (303, "/account")
    r = b.post("/reauth", data={"password": "wrong", "next": "/account?tab=a&b=1"})
    assert r.headers["location"] == "/reauth?next=%2Faccount%3Ftab%3Da%26b%3D1&error=wrong_password"
