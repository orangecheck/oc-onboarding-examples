"""The site's users. A first sign-in with orangecheck makes a new user with a random
id; one did per account; linking and unlinking are the site's own (ochk.io/docs/me/sdk)."""

import logging
import sqlite3
import uuid

from .db import db, now, transaction

log = logging.getLogger("site")


def user_by_id(user_id: str) -> sqlite3.Row | None:
    return db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def user_by_email(email: str) -> sqlite3.Row | None:
    return db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def create_password_user(email: str, password_hash: str) -> sqlite3.Row:
    user_id = str(uuid.uuid4())
    db().execute(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (user_id, email, password_hash, now()),
    )
    return user_by_id(user_id)


def user_for_did(did: str) -> sqlite3.Row | None:
    row = db().execute("SELECT user_id FROM oc_accounts WHERE did_oc = ?", (did,)).fetchone()
    return user_by_id(row["user_id"]) if row else None


def linked_did(user_id: str) -> str | None:
    row = db().execute("SELECT did_oc FROM oc_accounts WHERE user_id = ?", (user_id,)).fetchone()
    return row["did_oc"] if row else None


def user_for_first_sign_in(did: str) -> sqlite3.Row:
    """The user this did signs in as; a did seen for the first time gets a new user."""
    with transaction() as conn:
        row = conn.execute("SELECT user_id FROM oc_accounts WHERE did_oc = ?", (did,)).fetchone()
        if row:
            user_id = row["user_id"]
        else:
            user_id = str(uuid.uuid4())
            conn.execute("INSERT INTO users (id, created_at) VALUES (?, ?)", (user_id, now()))
            conn.execute("INSERT INTO oc_accounts (did_oc, user_id) VALUES (?, ?)", (did, user_id))
    return user_by_id(user_id)


def link_did(user_id: str, did: str) -> str:
    """'linked', 'did_taken' (another user has it) or 'already_linked' (one did per account)."""
    with transaction() as conn:
        holder = conn.execute("SELECT user_id FROM oc_accounts WHERE did_oc = ?", (did,)).fetchone()
        if holder:
            return "already_linked" if holder["user_id"] == user_id else "did_taken"
        if conn.execute("SELECT 1 FROM oc_accounts WHERE user_id = ?", (user_id,)).fetchone():
            return "already_linked"
        conn.execute("INSERT INTO oc_accounts (did_oc, user_id) VALUES (?, ?)", (did, user_id))
    return "linked"


def unlink_did(user_id: str) -> str | None:
    """Unlink, and end every session that did started here."""
    did = linked_did(user_id)
    if not did:
        return None
    with transaction() as conn:
        conn.execute("DELETE FROM oc_accounts WHERE user_id = ?", (user_id,))
        conn.execute(
            "DELETE FROM sessions WHERE user_id = ? AND via = 'orangecheck' AND did_oc = ?",
            (user_id, did),
        )
    return did


def set_connect(user_id: str, did: str, consent: bool) -> None:
    db().execute(
        "UPDATE users SET connect_did = ?, connect_consent = MAX(connect_consent, ?) WHERE id = ?",
        (did, 1 if consent else 0, user_id),
    )


def mark_connect_claimed(did: str) -> None:
    db().execute("UPDATE users SET connect_claimed = 1 WHERE connect_did = ?", (did,))


def delete_user(user_id: str) -> None:
    db().execute("DELETE FROM users WHERE id = ?", (user_id,))


def tell_account(user: sqlite3.Row, message: str) -> None:
    """Link and unlink are told to the account's email. Here, the log stands in for the mail."""
    if user["email"]:
        log.info("mail to %s: %s", user["email"], message)
