import { randomBytes, randomUUID } from 'node:crypto';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { NextApiRequest, NextApiResponse } from 'next';
import { vi } from 'vitest';

import { resetDbForTests } from '@/lib/db';
import { setEndedSessionsForTests } from '@/lib/sessions';

// Calls the site's real routes with a real database (in memory), in offline
// mode unless a test says otherwise. Sign-in tokens are signed here with a test
// key; the issuer's key set is answered from it, so verifyOcToken runs for real.

export const ORIGIN = 'http://localhost:3000';
export const ISSUER = `${ORIGIN}/stand-in`;

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown;

export interface Answer {
    status: number;
    body: Record<string, unknown>;
    cookie: string | null;
}

/** A browser: keeps the session cookie between calls, and says same-origin by default. */
export class Browser {
    cookie: string | null = null;

    async call(
        handler: Handler,
        opts: {
            method?: string;
            body?: unknown;
            headers?: Record<string, string>;
            site?: string;
        } = {},
    ): Promise<Answer> {
        const out: Answer = { status: 200, body: {}, cookie: null };
        const headers: Record<string, string> = {
            'sec-fetch-site': opts.site ?? 'same-origin',
            ...(this.cookie ? { cookie: this.cookie } : {}),
            ...opts.headers,
        };
        const req = { method: opts.method ?? 'POST', headers, body: opts.body ?? {}, query: {} };
        const res = {
            statusCode: 200,
            status(code: number) {
                out.status = code;
                this.statusCode = code;
                return this;
            },
            json(b: Record<string, unknown>) {
                out.body = b;
                return this;
            },
            end() {
                return this;
            },
            send() {
                return this;
            },
            setHeader(k: string, v: string) {
                if (k.toLowerCase() === 'set-cookie') out.cookie = v;
                return this;
            },
            getHeader() {
                return undefined;
            },
        };
        await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
        if (out.cookie) {
            const value = out.cookie.split(';')[0]!;
            this.cookie = /Max-Age=0/.test(out.cookie) ? null : value;
        }
        return out;
    }
}

const key = generateKeyPair('EdDSA', { crv: 'Ed25519' });

/** A sign-in token as ochk.io issues one: bound to this site, with a revocation handle. */
export async function token(
    did: string,
    opts: { aud?: string; rh?: string | null; iss?: string } = {},
): Promise<string> {
    const claims: Record<string, unknown> = { did_oc: did };
    if (opts.rh !== null) claims.rh = opts.rh ?? randomBytes(16).toString('base64url');
    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
        .setIssuer(opts.iss ?? ISSUER)
        .setAudience(opts.aud ?? ORIGIN)
        .setSubject('sub-' + did.slice(-6))
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign((await key).privateKey);
}

export const did = (c: string) => `did:oc:${c.repeat(32).slice(0, 32)}`;

/** Routes for fetch: the issuer's key set, plus whatever a test adds. Anything else fails. */
export async function stubFetch(
    extra: Record<string, (init: RequestInit) => Response | Promise<Response>> = {},
) {
    const jwk = {
        ...(await exportJWK((await key).publicKey)),
        kid: 'test',
        alg: 'EdDSA',
        use: 'sig',
    };
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
        const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
        const route = extra[url];
        if (route) return route(init);
        throw new Error(`unexpected fetch ${url}`);
    });
    return calls;
}

/** A fresh, offline site for each test. */
export function offlineSite(): void {
    for (const k of [
        'OC_PROJECT_KEY',
        'OC_SIGNING_SECRET',
        'OCHK_CONNECT_KEY',
        'CONNECT_MODE',
        'PORT',
    ]) {
        delete process.env[k];
    }
    process.env.SITE_ORIGIN = ORIGIN;
    resetDbForTests();
    setEndedSessionsForTests(undefined);
}
