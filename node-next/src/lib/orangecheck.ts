import { withOcAuth, type WithOcSession } from '@orangecheck/me-client/server';
import type { NextApiRequest, NextApiResponse } from 'next';

import { cfg } from './config';
import { db, now } from './db';
import { standInIssuer } from './stand-in';

// Sign in with orangecheck (ochk.io/docs/me/quickstart). The page sends the
// popup's token once, as a Bearer header, so the SDK's wrapper both verifies it
// (signature, issuer, and this site's exact origin as audience) and holds it to
// the project's "who can sign in" rule. The site's own session then takes over.

export type OcRequest = WithOcSession<NextApiRequest>;
type TokenHandler = (req: OcRequest, res: NextApiResponse, token: string) => unknown;

function bearer(req: NextApiRequest): string {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    return m?.[1] ?? '';
}

export function withSignInToken(handler: TokenHandler) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        const c = cfg();
        if (c.mode === 'live' && !c.projectKey) {
            return res.status(503).json({ ok: false, error: 'sign_in_not_configured' });
        }
        const options =
            c.mode === 'offline'
                ? {
                      audience: c.siteOrigin,
                      issuer: standInIssuer(),
                      revocation: false as const,
                      required: true,
                  }
                : { audience: c.siteOrigin, projectKey: c.projectKey, required: true };
        return withOcAuth<OcRequest, NextApiResponse>(
            async (r, s) => handler(r, s, bearer(r)),
            options,
        )(req, res);
    };
}

/**
 * Spend a token: it starts one session, once, on any server that shares this
 * table, until it expires. False when it was spent already.
 */
export function spendToken(jti: string, exp: number): boolean {
    db().prepare('DELETE FROM spent_tokens WHERE exp < ?').run(now());
    try {
        db().prepare('INSERT INTO spent_tokens (jti, exp) VALUES (?, ?)').run(jti, exp);
        return true;
    } catch {
        return false;
    }
}

/**
 * End the token at the auth host once the site's own session has taken over,
 * so me.ochk.io refuses it from then on (ochk.io/docs/me/sdk#ending-a-session).
 * Holding a token is the authority to end it; nothing else is sent.
 */
export async function endTokenAtOrangecheck(token: string): Promise<void> {
    if (cfg().mode !== 'live' || !token) return;
    try {
        await fetch('https://ochk.io/api/auth/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokens: [token] }),
            signal: AbortSignal.timeout(5000),
        });
    } catch (e) {
        // The token was spent here already; ending it at the host is belt and braces.
        console.warn('[orangecheck] could not end the token at ochk.io:', (e as Error).message);
    }
}
