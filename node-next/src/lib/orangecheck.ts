import {
    type JtiStore,
    revokeToken,
    spendOnce,
    withOcAuth,
    type WithOcSession,
} from '@orangecheck/me-client/server';
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

// Every server that accepts sign-ins shares this table, so a token starts one
// session, once, until it expires.
const spentTokens: JtiStore = {
    add(jti, exp) {
        db().prepare('DELETE FROM spent_tokens WHERE exp <= ?').run(now());
        const r = db()
            .prepare('INSERT OR IGNORE INTO spent_tokens (jti, exp) VALUES (?, ?)')
            .run(jti, exp);
        return r.changes === 1;
    },
};

/** False when the token was spent already, or has expired. */
export function spendToken(jti: string, exp: number): Promise<boolean> {
    return spendOnce(jti, exp, spentTokens);
}

/**
 * End the token at the auth host once the site's own session has taken over,
 * so me.ochk.io refuses it from then on (ochk.io/docs/me/sdk#ending-a-session).
 * A token ochk.io couldn't take right now waits in unended_tokens until the
 * next sign-in sends it again, or until it expires.
 */
export async function endTokenAtOrangecheck(token: string, exp: number): Promise<void> {
    if (cfg().mode !== 'live') return;
    db().prepare('DELETE FROM unended_tokens WHERE exp <= ?').run(now());
    const waiting = (
        db().prepare('SELECT token FROM unended_tokens LIMIT 7').all() as Array<{ token: string }>
    ).map((r) => r.token);
    const result = await revokeToken([token, ...waiting]);
    if (result.ok || result.reason === 'bad_request') {
        const drop = db().prepare('DELETE FROM unended_tokens WHERE token = ?');
        for (const t of waiting) drop.run(t);
        if (!result.ok) console.warn('[orangecheck] ochk.io refused to end the tokens (400)');
        return;
    }
    db().prepare('INSERT OR IGNORE INTO unended_tokens (token, exp) VALUES (?, ?)').run(token, exp);
    console.warn(`[orangecheck] could not end the token at ochk.io (${result.reason}); queued`);
}
