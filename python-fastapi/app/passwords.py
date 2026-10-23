"""The site's own login: scrypt, from the standard library."""

import base64
import hashlib
import hmac
import secrets

_N, _R, _P = 2**14, 8, 1


def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    b64 = base64.b64encode
    return f"scrypt${b64(salt).decode()}${b64(_scrypt(password, salt)).decode()}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    return hmac.compare_digest(_scrypt(password, base64.b64decode(salt)), base64.b64decode(digest))


# Hashed either way, so an unknown address takes as long as a wrong password.
DECOY = hash_password("not anyone's password")
