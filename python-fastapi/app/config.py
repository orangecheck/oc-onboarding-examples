"""What this site runs against: orangecheck itself (live), or the stand-ins in this
folder (offline, so the funnel can be clicked through with no account)."""

import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file(path: Path = Path(".env")) -> None:
    """Read KEY=VALUE lines from .env into the environment, never over a value already set."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def _read(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


@dataclass(frozen=True)
class Config:
    mode: str  # "offline" | "live"
    site_origin: str  # exactly: the audience every sign-in token must name
    project_key: str | None
    signing_secret: str | None
    connect_key: str | None
    connect_mode: str  # "opt-in" | "seamless"
    production: bool


def cfg() -> Config:
    """Read on every call, so a test can change the environment between cases."""
    project_key = _read("OC_PROJECT_KEY")
    connect_key = _read("OCHK_CONNECT_KEY")
    origin = _read("SITE_ORIGIN") or f"http://localhost:{_read('PORT') or '8000'}"
    return Config(
        mode="live" if project_key or connect_key else "offline",
        site_origin=origin.rstrip("/"),
        project_key=project_key,
        signing_secret=_read("OC_SIGNING_SECRET"),
        connect_key=connect_key,
        connect_mode="seamless" if _read("CONNECT_MODE") == "seamless" else "opt-in",
        production=_read("APP_ENV") == "production",
    )


def ended_sessions_checked(c: Config | None = None) -> bool:
    """True when sessions people ended everywhere are refused here (both keys set)."""
    c = c or cfg()
    return c.mode == "live" and bool(c.project_key and c.signing_secret)


def assert_deployable(c: Config | None = None) -> None:
    """A deployment refuses to start without its exact https origin and both keys,
    so a session someone ended everywhere is refused here too. Offline mode never
    runs in production."""
    c = c or cfg()
    if not c.production:
        return
    missing = [n for n in ("SITE_ORIGIN", "OC_PROJECT_KEY", "OC_SIGNING_SECRET") if not _read(n)]
    if missing:
        raise RuntimeError(f"Refusing to start in production without {', '.join(missing)}.")
    if not c.site_origin.startswith("https://"):
        raise RuntimeError("Refusing to start in production: SITE_ORIGIN must be https.")
