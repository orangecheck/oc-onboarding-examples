import { randomUUID } from 'node:crypto';

import { db, now, transaction } from './db';

export interface User {
    id: string;
    email: string | null;
    password_hash: string | null;
    connect_did: string | null;
    connect_consent: number;
    connect_claimed: number;
}

export function userById(id: string): User | null {
    return (db().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

export function userByEmail(email: string): User | null {
    return (
        (db().prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined) ?? null
    );
}

/** A new user of the site's own login. The id is random: nothing derives it. */
export function createPasswordUser(email: string, passwordHash: string): User {
    const id = randomUUID();
    db()
        .prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(id, email, passwordHash, now());
    return userById(id)!;
}

/** Who signed in with orangecheck as this did, if anyone. */
export function userForDid(did: string): User | null {
    const row = db().prepare('SELECT user_id FROM oc_accounts WHERE did_oc = ?').get(did) as
        { user_id: string } | undefined;
    return row ? userById(row.user_id) : null;
}

export function linkedDid(userId: string): string | null {
    const row = db().prepare('SELECT did_oc FROM oc_accounts WHERE user_id = ?').get(userId) as
        { did_oc: string } | undefined;
    return row?.did_oc ?? null;
}

/**
 * A first sign-in creates a user; it never finds one by anything derived from
 * the did. Two first sign-ins at once: the loser's insert hits the primary key,
 * its transaction rolls back (so no orphan user), and it reads the winner.
 */
export function userForFirstSignIn(did: string): User {
    const existing = userForDid(did);
    if (existing) return existing;
    try {
        return transaction(() => {
            const id = randomUUID();
            db().prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(id, now());
            db().prepare('INSERT INTO oc_accounts (did_oc, user_id) VALUES (?, ?)').run(did, id);
            return userById(id)!;
        });
    } catch (e) {
        const winner = userForDid(did);
        if (winner) return winner;
        throw e;
    }
}

export type LinkResult = 'linked' | 'did_taken' | 'already_linked';

/** One did per user and one user per did, held by the database. */
export function linkDid(userId: string, did: string): LinkResult {
    if (linkedDid(userId)) return 'already_linked';
    const owner = userForDid(did);
    if (owner) return owner.id === userId ? 'linked' : 'did_taken';
    try {
        db().prepare('INSERT INTO oc_accounts (did_oc, user_id) VALUES (?, ?)').run(did, userId);
        return 'linked';
    } catch {
        return userForDid(did)?.id === userId ? 'linked' : 'did_taken';
    }
}

/** Unlink, and end every session that did started here. */
export function unlinkDid(userId: string): string | null {
    const did = linkedDid(userId);
    if (!did) return null;
    transaction(() => {
        db().prepare('DELETE FROM oc_accounts WHERE user_id = ?').run(userId);
        db()
            .prepare(
                "DELETE FROM sessions WHERE user_id = ? AND via = 'orangecheck' AND did_oc = ?",
            )
            .run(userId, did);
    });
    return did;
}

export function setConnect(userId: string, did: string, consent: boolean): void {
    db()
        .prepare(
            'UPDATE users SET connect_did = ?, connect_consent = MAX(connect_consent, ?) WHERE id = ?',
        )
        .run(did, consent ? 1 : 0, userId);
}

export function markConnectClaimed(did: string): void {
    db().prepare('UPDATE users SET connect_claimed = 1 WHERE connect_did = ?').run(did);
}

export function deleteUser(userId: string): void {
    db().prepare('DELETE FROM users WHERE id = ?').run(userId);
}

/**
 * The account's own address is told on link and unlink. This reference has no
 * mail sender, so it writes the message to the log; send it in yours.
 */
export function tellAccount(user: User, what: string): void {
    console.info(`[email to ${user.email ?? '(no email on this account)'}] ${what}`);
}
