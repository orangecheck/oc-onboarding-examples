import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// SQLite in one file, so a clone runs with nothing to install. A real
// deployment keeps the same tables in its own database.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                     -- random, never derived from anything
    email TEXT UNIQUE,                       -- null for someone who only signs in with orangecheck
    password_hash TEXT,
    connect_did TEXT UNIQUE,                 -- the account Connect made for them
    connect_consent INTEGER NOT NULL DEFAULT 0,
    connect_claimed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
-- Sign in with orangecheck: one did per user, one user per did.
CREATE TABLE IF NOT EXISTS oc_accounts (
    did_oc TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,                -- sha256 of the cookie's value
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    via TEXT NOT NULL CHECK (via IN ('password', 'orangecheck')),
    did_oc TEXT,                             -- orangecheck sessions: who, and the token's
    rh TEXT,                                 -- rh, aud and iat, to end the session when
    aud TEXT,                                -- the person ends every session
    iat INTEGER,
    fresh_until INTEGER NOT NULL DEFAULT 0,  -- a password confirmed this recently can link or unlink
    expires_at INTEGER NOT NULL
);
-- A sign-in token starts one session, once.
CREATE TABLE IF NOT EXISTS spent_tokens (
    jti TEXT PRIMARY KEY,
    exp INTEGER NOT NULL
);
-- Offline mode only: the stand-in for Connect's accounts.
CREATE TABLE IF NOT EXISTS stand_in_connect (
    user_id TEXT PRIMARY KEY,
    did_oc TEXT NOT NULL UNIQUE,
    consent INTEGER NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0
);
`;

const g = globalThis as { __siteDb?: DatabaseSync };

export function db(): DatabaseSync {
    if (!g.__siteDb) {
        const path = process.env.DB_PATH ?? '.data/site.db';
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
        const d = new DatabaseSync(path);
        d.exec('PRAGMA foreign_keys = ON;');
        d.exec(SCHEMA);
        g.__siteDb = d;
    }
    return g.__siteDb;
}

/** Tests: start the next case on an empty database. */
export function resetDbForTests(): void {
    g.__siteDb?.close();
    g.__siteDb = undefined;
}

export function now(): number {
    return Math.floor(Date.now() / 1000);
}

/** Run `fn` in one transaction; roll back if it throws. */
export function transaction<T>(fn: () => T): T {
    const d = db();
    d.exec('BEGIN IMMEDIATE');
    try {
        const out = fn();
        d.exec('COMMIT');
        return out;
    } catch (e) {
        d.exec('ROLLBACK');
        throw e;
    }
}
