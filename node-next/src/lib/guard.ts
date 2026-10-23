import type { NextApiRequest, NextApiResponse } from 'next';

import { now } from './db';
import { currentSession, type Session } from './sessions';
import { type User, userById } from './users';

const FRESH_SECONDS = 5 * 60;

/** The signed-in user for an API route, or an answer already sent. */
export async function signedIn(
    req: NextApiRequest,
    res: NextApiResponse,
): Promise<{ session: Session; user: User } | null> {
    const s = await currentSession(req);
    if (s === 'unavailable') {
        // The list of ended sessions can't be read: writes wait, and this is not "signed out".
        res.status(503).json({ ok: false, error: 'revocations_unavailable' });
        return null;
    }
    const user = s ? userById(s.user_id) : null;
    if (!s || !user) {
        res.status(401).json({ ok: false, error: 'signed_out' });
        return null;
    }
    return { session: s, user };
}

/**
 * Linking, unlinking and deleting ask for a fresh sign-in with the site's own
 * login, never one the did itself started. Someone with no login of their own
 * (they only ever signed in with orangecheck) shows a session minutes old.
 */
export function freshEnough(session: Session, user: User): boolean {
    if (session.via === 'password') return session.fresh_until > now();
    return !user.password_hash && session.expires_at - 30 * 24 * 3600 > now() - FRESH_SECONDS;
}

/** Connect is for people who came in through the site's own login. */
export function connectFor(user: User, linked: string | null): boolean {
    return Boolean(user.password_hash) && !linked;
}

export { FRESH_SECONDS };
