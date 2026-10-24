"""One SQLite file in .data/ (":memory:" in tests). Fine on one server with a disk;
on more than one, move these tables to your own database."""

import os
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    connect_did TEXT UNIQUE,
    connect_consent INTEGER NOT NULL DEFAULT 0,
    connect_claimed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oc_accounts (
    did_oc TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    via TEXT NOT NULL CHECK (via IN ('password', 'orangecheck')),
    did_oc TEXT,
    rh TEXT,
    aud TEXT,
    iat INTEGER,
    fresh_until INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spent_tokens (
    jti TEXT PRIMARY KEY,
    exp INTEGER NOT NULL
);
-- Tokens ochk.io couldn't end yet, sent again on the next sign-in. Each is a
-- live credential until it expires: keep this table as private as sessions.
CREATE TABLE IF NOT EXISTS unended_tokens (
    token TEXT PRIMARY KEY,
    exp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stand_in_connect (
    user_id TEXT PRIMARY KEY,
    did_oc TEXT NOT NULL UNIQUE,
    consent INTEGER NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0
);
"""

_local = threading.local()
_memory: sqlite3.Connection | None = None


def _open(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def db() -> sqlite3.Connection:
    """One connection per thread, so a transaction never takes in another request's write."""
    global _memory
    path = os.environ.get("DB_PATH") or ".data/site.db"
    if path == ":memory:":
        if _memory is None:
            _memory = _open(path)
        return _memory
    conn = getattr(_local, "conn", None)
    if conn is None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = _local.conn = _open(path)
    return conn


def reset_db_for_tests() -> None:
    global _memory
    if _memory is not None:
        _memory.close()
    _memory = None


def now() -> int:
    return int(time.time())


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE: a check and the write it decides happen as one."""
    conn = db()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")
