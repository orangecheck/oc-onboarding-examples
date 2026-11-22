import { Readable } from 'node:stream';

import { exportJWK, generateKeyPair } from 'jose';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import signup from '@/pages/api/signup';
import receive from '@/pages/api/webhooks/orangecheck';

import { Browser, offlineSite, stubFetch } from './harness';

// Deliveries signed as me.ochk.io signs them, with a key its key set answers.
const key = generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
const WEBHOOK_JWKS = 'https://me.ochk.io/api/dev-jwks';

async function deliver(fields: Record<string, unknown>) {
    const body = JSON.stringify({
        id: 'sys_connect_claimed_1',
        issued_at: new Date().toISOString(),
        ...fields,
    });
    const bytes = new TextEncoder().encode(body);
    const sig = await crypto.subtle.sign('Ed25519', (await key).privateKey, bytes);
    const req = Object.assign(Readable.from([Buffer.from(bytes)]), {
        method: 'POST',
        headers: { 'oc-signature': Buffer.from(sig).toString('hex'), 'oc-key-id': 'wh' },
    });
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = {
        status(code: number) {
            out.status = code;
            return this;
        },
        json(b: Record<string, unknown>) {
            out.body = b;
            return this;
        },
        end() {
            return this;
        },
    };
    await receive(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    return out;
}

const claimed = () =>
    db().prepare('SELECT connect_did, connect_claimed FROM users').get() as {
        connect_did: string;
        connect_claimed: number;
    };

beforeEach(async () => {
    offlineSite();
    const jwk = { ...(await exportJWK((await key).publicKey)), kid: 'wh', alg: 'EdDSA' };
    await stubFetch({ [WEBHOOK_JWKS]: () => Response.json({ keys: [jwk] }) });
});
afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OC_PROJECT_KEY;
});

describe('connect.claimed', () => {
    it("marks the account claimed, for this project's deliveries only", async () => {
        const b = new Browser();
        const body = {
            email: 'ada@example.com',
            password: 'correct horse battery',
            orangecheck: true,
        };
        expect((await b.call(signup, { body })).status).toBe(200);
        process.env.OC_PROJECT_KEY = 'pk_test_x';
        const notice = {
            kind: 'oc-system-event',
            subtype: 'connect.claimed',
            did_oc: claimed().connect_did,
        };

        // One key signs every project's deliveries: another project's is refused.
        const theirs = await deliver({ ...notice, project_key: 'pk_test_other' });
        expect(theirs.status).toBe(401);
        expect(String(theirs.body.error)).toMatch(/another project/);
        const old = await deliver({
            ...notice,
            project_key: 'pk_test_x',
            issued_at: '2026-01-01T00:00:00.000Z',
        });
        expect(old.status).toBe(401);
        expect(claimed().connect_claimed).toBe(0);

        expect((await deliver({ ...notice, project_key: 'pk_test_x' })).status).toBe(200);
        expect(claimed().connect_claimed).toBe(1);
    });

    it('is not taken offline, with no project to check against', async () => {
        expect(
            (await deliver({ subtype: 'connect.claimed', project_key: 'pk_test_x' })).status,
        ).toBe(404);
    });
});
