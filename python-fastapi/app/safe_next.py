"""Where to send someone back to after a fresh sign-in."""

import re
from urllib.parse import urljoin, urlsplit, urlunsplit

# Control characters, which browsers drop ("/\t/evil.com" becomes "//evil.com"), and backslash.
_REFUSED = re.compile(r"[\x00-\x1f\x7f\\]")
# A dot segment, plain or percent-encoded, which can collapse into "//" ("/..//evil.com").
_DOTS = re.compile(r"(?:\.|%2e){1,2}", re.IGNORECASE)
_BASE = "https://site.invalid"


def safe_next(value: object, fallback: str = "/account") -> str:
    """A path on this site, or `fallback`. Refuses anything a browser would take
    to another site: `//evil.com`, `/\\evil.com`, a scheme, control characters and
    dot segments."""
    if not isinstance(value, str) or not value or len(value) > 2048:
        return fallback
    if not value.startswith("/") or value.startswith(("//", "/\\")) or _REFUSED.search(value):
        return fallback
    if any(_DOTS.fullmatch(s) for s in re.split(r"[?#]", value, maxsplit=1)[0].split("/")):
        return fallback
    parts = urlsplit(urljoin(_BASE, value))
    if f"{parts.scheme}://{parts.netloc}" != _BASE:
        return fallback
    path = urlunsplit(("", "", parts.path, parts.query, parts.fragment))
    return fallback if path.startswith(("//", "/\\")) else path
