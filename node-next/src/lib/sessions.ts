import { createHash, randomBytes } from 'node:crypto';

import { integratorRevocationCheck, type RevocationCheck } from '@orangecheck/auth-core';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { cfg, endedSessionsChecked } from './config';
import { db, now } from './db';

// The site's own sessions. A sign-in with orangecheck starts one of these and
// the token is spent: what it leaves behind is its rh, aud and iat, so the
// session ends when the person ends every session (ochk.io/docs/me/sdk).

const COOKIE = 'site_session';
const DAYS_30 = 30 * 24 * 3600;
const FRESH_SECONDS = 5 * 60;

export interface Session {
    id_hash: string;
    user_id: string;
    via: 'password' | 'orangecheck';
    did_oc: string | null;
    rh: string | null;
    aud: string | null;
    iat: number | null;
    fresh_until: number;
    expires_at: number;
}

export interface OcClaims {
    did_oc: string;
    rh: string;
    aud: string;
    iat: number;
}

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

function cookieValue(req: IncomingMessage): string | null {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === COOKIE) return v.join('=') || null;
    }
    return null;
}

function setCookie(res: ServerResponse, value: string, maxAge: number): void {
    const secure = cfg().siteOrigin.startsWith('https://') ? '; Secure' : '';
    res.setHeader(
        'Set-Cookie',
        `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    );
}

/** Start a session; an orangecheck one carries the token's handle with it. */
export function startSession(
    res: ServerResponse,
    userId: string,
    via: Session['via'],
    oc?: OcClaims,
    fresh = false,
): void {
    const id = randomBytes(32).toString('base64url');
    db()
        .prepare(
            `INSERT INTO sessions (id_hash, user_id, via, did_oc, rh, aud, iat, fresh_until, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
            hash(id),
            userId,
            via,
            oc?.did_oc ?? null,
            oc?.rh ?? null,
            oc?.aud ?? null,
            oc?.iat ?? null,
            fresh ? now() + FRESH_SECONDS : 0,
            now() + DAYS_30,
        );
    setCookie(res, id, DAYS_30);
}

export function endSession(req: IncomingMessage, res: ServerResponse): void {
    const id = cookieValue(req);
    if (id) db().prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash(id));
    setCookie(res, '', 0);
}

const g = globalThis as { __ended?: RevocationCheck | null };

/** One list of ended sessions per process, from OC_PROJECT_KEY and OC_SIGNING_SECRET. */
function endedSessions(): RevocationCheck | null {
    if (!endedSessionsChecked()) return null;
    if (g.__ended === undefined) g.__ended = integratorRevocationCheck();
    return g.__ended;
}

/** Tests: hand in the check the next requests use. */
export function setEndedSessionsForTests(check: RevocationCheck | null | undefined): void {
    g.__ended = check;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The request's session, or null. An orangecheck session is asked about on
 * every request: ended everywhere means signed out here too; while the list
 * can't be read, reads go on and writes answer 'unavailable' (never "signed
 * out", so the page retries instead of sending the person to sign in).
 */
export async function currentSession(
    req: IncomingMessage,
): Promise<Session | null | 'unavailable'> {
    const id = cookieValue(req);
    if (!id) return null;
    const s = db()
        .prepare('SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?')
        .get(hash(id), now()) as Session | undefined;
    if (!s) return null;
    if (s.via !== 'orangecheck') return s;
    const check = endedSessions();
    if (!check) return s;
    const status = await check.status({ rh: s.rh, aud: s.aud, iat: s.iat });
    if (status === 'revoked') {
        db().prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash);
        return null;
    }
    if (status === 'unverified' && !SAFE.has(req.method ?? 'GET')) return 'unavailable';
    return s;
}
