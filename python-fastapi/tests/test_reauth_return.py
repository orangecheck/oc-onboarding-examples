"""The return path after a fresh sign-in never leaves the site.

The rule is orangecheck's safe_return_path, held to the SDK's own vectors;
these hold the route to it.
"""

import pytest

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
def test_the_reauth_page_refuses_a_path_off_the_site(raw):
    b = signed_up()
    r = b.post("/reauth", data={"password": PASSWORD, "next": raw})
    assert (r.status_code, r.headers["location"]) == (303, "/account")


def test_the_reauth_page_keeps_a_path_on_this_site():
    b = signed_up()
    r = b.post("/reauth", data={"password": PASSWORD, "next": "/account?tab=a&b=1"})
    assert (r.status_code, r.headers["location"]) == (303, "/account?tab=a&b=1")


def test_the_reauth_route_sends_an_off_site_next_home():
    b = signed_up()
    r = b.post("/reauth", data={"password": PASSWORD, "next": "//1249741522"})
    assert (r.status_code, r.headers["location"]) == (303, "/account")
    r = b.post("/reauth", data={"password": "wrong", "next": "/account?tab=a&b=1"})
    assert r.headers["location"] == "/reauth?next=%2Faccount%3Ftab%3Da%26b%3D1&error=wrong_password"
