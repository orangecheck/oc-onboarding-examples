import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertDeployable } from '@/lib/config';
import { db, now } from '@/lib/db';
import { setEndedSessionsForTests } from '@/lib/sessions';
import deleteAccount from '@/pages/api/account/delete';
import link from '@/pages/api/account/link';
import unlink from '@/pages/api/account/unlink';
import signInWithOrangecheck from '@/pages/api/auth/orangecheck';
import claimLink from '@/pages/api/connect/claim-link';
import provisionRoute from '@/pages/api/connect/provision';
import reauth from '@/pages/api/reauth';
import signin from '@/pages/api/signin';
import signup from '@/pages/api/signup';
import standInClaim from '@/pages/api/stand-in/claim';
import standInToken from '@/pages/api/stand-in/token';

import { Browser, did, ISSUER, LIVE_ISSUER, offlineSite, stubFetch, token } from './harness';

const PASSWORD = 'correct horse battery';

beforeEach(async () => {
    offlineSite();
    await stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

async function signedUp(email = 'ada@example.com', orangecheck = false) {
    const b = new Browser();
    const r = await b.call(signup, { body: { email, password: PASSWORD, orangecheck } });
    expect(r.status).toBe(200);
    return b;
}

const bearer = async (d: string, opts?: Parameters<typeof token>[1]) => ({
    headers: { authorization: `Bearer ${await token(d, opts)}` },
});

const users = () => db().prepare('SELECT * FROM users').all() as Array<Record<string, unknown>>;

describe('the site’s own login, with Connect', () => {
    it('signs in with the right password only', async () => {
        await signedUp();
        const as = (password: string) =>
            new Browser().call(signin, { body: { email: 'ada@example.com', password } });
        expect((await as('nope nope nope')).body).toMatchObject({
            error: 'wrong_email_or_password',
        });
        expect((await as(PASSWORD)).status).toBe(200);
    });
    it('takes an email in any case and with any surrounding space', async () => {
        await signedUp(' Ada@Example.COM ');
        // U+FEFF is space to JavaScript's trim, and so to orangecheck's normalizeEmail.
        for (const email of ['ada@example.com', '\ufeffADA@example.com', 'ada@EXAMPLE.com\t']) {
            const r = await new Browser().call(signin, { body: { email, password: PASSWORD } });
            expect(r.status, email).toBe(200);
        }
    });
    it('opt-in: an unticked box makes no orangecheck account', async () => {
        await signedUp('ada@example.com', false);
        expect(users()[0]!.connect_did).toBeNull();
    });

    it('opt-in: a tick makes one, with consent recorded', async () => {
        await signedUp('ada@example.com', true);
        expect(users()[0]).toMatchObject({ connect_consent: 1 });
        expect(String(users()[0]!.connect_did)).toMatch(/^did:oc:[0-9a-f]{32}$/);
    });

    it('seamless: every sign-up gets one, identity only', async () => {
        process.env.CONNECT_MODE = 'seamless';
        await signedUp('ada@example.com', false);
        expect(users()[0]).toMatchObject({ connect_consent: 0 });
        expect(users()[0]!.connect_did).not.toBeNull();
        expect(db().prepare('SELECT consent FROM stand_in_connect').get()).toEqual({ consent: 0 });
    });

    it('a claim link is for the signed-in user only, and claiming marks it claimed', async () => {
        expect((await new Browser().call(claimLink)).status).toBe(401);
        const b = await signedUp('ada@example.com', true);
        const r = await b.call(claimLink);
        expect(r.status).toBe(200);
        const t = new URL(String(r.body.url)).hash.slice(3);
        expect((await b.call(standInClaim, { body: { t } })).status).toBe(200);
        expect(users()[0]).toMatchObject({ connect_claimed: 1 });
        expect((await b.call(standInClaim, { body: { t } })).status).toBe(410); // works once
    });

    it('a claim link stops working once the account is deleted', async () => {
        const b = await signedUp('ada@example.com', true);
        const t = new URL(String((await b.call(claimLink)).body.url)).hash.slice(3);
        await b.call(reauth, { body: { password: PASSWORD } });
        expect((await b.call(deleteAccount)).status).toBe(200);
        expect((await new Browser().call(standInClaim, { body: { t } })).status).toBe(410);
    });

    it('a later tick on the account page upgrades a seamless account to consented', async () => {
        process.env.CONNECT_MODE = 'seamless';
        const b = await signedUp();
        const before = users()[0]!.connect_did;
        expect((await b.call(provisionRoute, { body: { orangecheck: true } })).status).toBe(200);
        expect(users()[0]).toMatchObject({ connect_did: before, connect_consent: 1 });
    });
});

describe('Connect, live: what this site sends ochk.io', () => {
    const PROVISION = 'https://ochk.io/api/connect/provision';

    async function liveSignup(orangecheck: boolean) {
        process.env.OCHK_CONNECT_KEY = 'occ_sk_test';
        const calls = await stubFetch({
            [PROVISION]: () => Response.json({ ok: true, did_oc: did('c'), is_new: true }),
        });
        await signedUp('ada@example.com', orangecheck);
        return calls.filter((c) => c.url === PROVISION).map((c) => c.body);
    }

    it('opt-in, unticked: no call at all', async () => {
        expect(await liveSignup(false)).toEqual([]);
    });

    it('opt-in, ticked: the call carries consent', async () => {
        expect(await liveSignup(true)).toEqual([{ user_id: users()[0]!.id, consent: true }]);
    });

    it('seamless: the call never claims a consent nobody gave', async () => {
        process.env.CONNECT_MODE = 'seamless';
        expect(await liveSignup(false)).toEqual([{ user_id: users()[0]!.id }]);
    });
});

describe('sign in with orangecheck', () => {
    it('a first sign-in creates a new user; the same did signs in to it again', async () => {
        const a = new Browser();
        expect((await a.call(signInWithOrangecheck, await bearer(did('a')))).status).toBe(200);
        const b = new Browser();
        expect((await b.call(signInWithOrangecheck, await bearer(did('a')))).status).toBe(200);
        expect(users()).toHaveLength(1);
        expect(users()[0]).toMatchObject({ email: null, password_hash: null });
    });

    it('offline, nothing goes to ochk.io', async () => {
        const calls = await stubFetch();
        expect(
            (await new Browser().call(signInWithOrangecheck, await bearer(did('a')))).status,
        ).toBe(200);
        expect(calls.filter((c) => !c.url.startsWith(ISSUER))).toEqual([]);
    });

    it('a token starts one session, once', async () => {
        const t = await bearer(did('a'));
        expect((await new Browser().call(signInWithOrangecheck, t)).status).toBe(200);
        expect((await new Browser().call(signInWithOrangecheck, t)).body).toMatchObject({
            error: 'token_spent',
        });
    });

    it('a token without rh is refused: nothing could end its session', async () => {
        const r = await new Browser().call(
            signInWithOrangecheck,
            await bearer(did('a'), { rh: null }),
        );
        expect(r).toMatchObject({ status: 401, body: { reason: 'no_session_handle' } });
        expect(r.cookie).toBeNull();
        expect(users()).toHaveLength(0);
    });

    it('a token issued to another site is refused', async () => {
        const r = await new Browser().call(
            signInWithOrangecheck,
            await bearer(did('a'), { aud: 'https://other.example' }),
        );
        expect(r.status).toBe(401);
        expect(users()).toHaveLength(0);
    });

    it('while ochk.io’s keys can’t be read, sign-in says try again, never "signed out"', async () => {
        await stubFetch({
            [`${ISSUER}/.well-known/jwks.json`]: () => new Response('', { status: 503 }),
        });
        const r = await new Browser().call(signInWithOrangecheck, await bearer(did('a')));
        expect(r).toMatchObject({ status: 503, body: { reason: 'key_set_unavailable' } });
        expect(users()).toHaveLength(0);
    });

    it('a cross-site request is refused before anything is read', async () => {
        const r = await new Browser().call(signInWithOrangecheck, {
            ...(await bearer(did('a'))),
            site: 'cross-site',
        });
        expect(r).toMatchObject({ status: 403, body: { error: 'cross_site' } });
    });

    it('the stand-in popup issues tokens to this site only, and only offline', async () => {
        const r = await new Browser().call(standInToken, { body: { name: 'Ada' } });
        expect(r.status).toBe(200);
        process.env.OC_PROJECT_KEY = 'pk_test_x';
        expect((await new Browser().call(standInToken, { body: { name: 'Ada' } })).status).toBe(
            404,
        );
    });
});

describe('sign in with orangecheck, live: ending the token at ochk.io', () => {
    const REVOKE = `${LIVE_ISSUER}/api/auth/revoke`;
    let answer: () => Response;
    let calls: Awaited<ReturnType<typeof stubFetch>>;

    beforeEach(async () => {
        process.env.OC_PROJECT_KEY = 'pk_test_example';
        answer = () => Response.json({ ok: true, revoked: 1 });
        calls = await stubFetch({
            'https://me.ochk.io/api/integrator/pk_test_example/sign-in': () =>
                Response.json({ ok: true, require_bond: null }),
            [REVOKE]: () => answer(),
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    async function signIn(d: string) {
        const t = await token(d, { iss: LIVE_ISSUER });
        const r = await new Browser().call(signInWithOrangecheck, {
            headers: { authorization: `Bearer ${t}` },
        });
        expect(r.status).toBe(200);
        return t;
    }
    const sent = () =>
        calls.filter((c) => c.url === REVOKE).map((c) => (c.body as { tokens: string[] }).tokens);
    const waiting = () =>
        (db().prepare('SELECT token FROM unended_tokens').all() as Array<{ token: string }>).map(
            (r) => r.token,
        );

    it('a sign-in ends its token there', async () => {
        const t = await signIn(did('a'));
        expect(sent()).toEqual([[t]]);
        expect(waiting()).toEqual([]);
    });

    it.each([503, 429])(
        'a token ochk.io couldn’t take (%i) goes with the next sign-in, then is dropped',
        async (status) => {
            answer = () => new Response('', { status });
            const first = await signIn(did('a'));
            expect(waiting()).toEqual([first]);
            answer = () => Response.json({ ok: true, revoked: 2 });
            const second = await signIn(did('b'));
            expect(sent()).toEqual([[first], [second, first]]);
            expect(waiting()).toEqual([]);
        },
    );

    it('a refused call (400) leaves nothing waiting', async () => {
        answer = () => new Response('', { status: 503 });
        await signIn(did('a'));
        answer = () => new Response('', { status: 400 });
        await signIn(did('b'));
        expect(waiting()).toEqual([]);
    });

    it('an expired token is not sent again', async () => {
        db().prepare('INSERT INTO unended_tokens (token, exp) VALUES (?, ?)').run('old', now());
        const t = await signIn(did('a'));
        expect(sent()).toEqual([[t]]);
        expect(waiting()).toEqual([]);
    });
});

describe('linking orangecheck to an account with its own login', () => {
    it('asks for the password first, then links one did', async () => {
        const b = await signedUp();
        expect((await b.call(link, await bearer(did('a')))).body).toMatchObject({
            error: 'confirm_password_first',
        });
        expect((await b.call(reauth, { body: { password: PASSWORD } })).status).toBe(200);
        expect((await b.call(link, await bearer(did('a')))).status).toBe(200);
        expect((await b.call(link, await bearer(did('b')))).body).toMatchObject({
            error: 'already_linked',
        });
    });

    it('refuses a did another user has', async () => {
        await new Browser().call(signInWithOrangecheck, await bearer(did('a')));
        const b = await signedUp();
        await b.call(reauth, { body: { password: PASSWORD } });
        expect((await b.call(link, await bearer(did('a')))).body).toMatchObject({
            error: 'did_taken',
        });
    });

    it('a session the did started can’t stand in for the password', async () => {
        const b = await signedUp();
        await b.call(reauth, { body: { password: PASSWORD } });
        await b.call(link, await bearer(did('a')));
        const viaOc = new Browser();
        await viaOc.call(signInWithOrangecheck, await bearer(did('a')));
        expect((await viaOc.call(unlink)).body).toMatchObject({ error: 'confirm_password_first' });
    });

    it('unlinking ends every session that did started here', async () => {
        const b = await signedUp();
        await b.call(reauth, { body: { password: PASSWORD } });
        await b.call(link, await bearer(did('a')));
        const viaOc = new Browser();
        await viaOc.call(signInWithOrangecheck, await bearer(did('a')));
        expect((await b.call(unlink)).status).toBe(200);
        expect((await viaOc.call(claimLink)).status).toBe(401);
    });
});

describe('ending every session', () => {
    async function orangecheckSession() {
        const b = new Browser();
        await b.call(signInWithOrangecheck, await bearer(did('a')));
        return b;
    }

    it('an ended session is signed out here, on localhost too (a declared development origin)', async () => {
        const b = await orangecheckSession();
        process.env.OC_PROJECT_KEY = 'pk_test_x';
        process.env.OC_SIGNING_SECRET = 'secret';
        setEndedSessionsForTests({ status: async () => 'revoked', refuses: async () => true });
        expect((await b.call(claimLink)).status).toBe(401);
    });

    it('while the list can’t be read, writes wait and are not "signed out"', async () => {
        const b = await orangecheckSession();
        process.env.OC_PROJECT_KEY = 'pk_test_x';
        process.env.OC_SIGNING_SECRET = 'secret';
        setEndedSessionsForTests({ status: async () => 'unverified', refuses: async () => true });
        expect((await b.call(claimLink)).body).toMatchObject({ error: 'revocations_unavailable' });
    });
});

describe('deleting an account', () => {
    it('deletes the orangecheck account Connect made, then the user', async () => {
        const b = await signedUp('ada@example.com', true);
        await b.call(reauth, { body: { password: PASSWORD } });
        expect((await b.call(deleteAccount)).status).toBe(200);
        expect(users()).toHaveLength(0);
        const row = db().prepare('SELECT deleted FROM stand_in_connect').get() as {
            deleted: number;
        };
        expect(row.deleted).toBe(1);
    });

    it('live: an account that earned stays, and the person gets a claim link first', async () => {
        const b = await signedUp('ada@example.com', true);
        process.env.OCHK_CONNECT_KEY = 'occ_sk_test';
        await stubFetch({
            'https://ochk.io/api/connect/delete': () =>
                Response.json({ ok: false, reason: 'holds_earnings' }, { status: 409 }),
            'https://ochk.io/api/connect/claim-link': () =>
                Response.json({
                    ok: true,
                    url: 'https://ochk.app/connect/claim#t=abc',
                    expires_at: '2026-10-24T00:00:00Z',
                }),
        });
        await b.call(reauth, { body: { password: PASSWORD } });
        const r = await b.call(deleteAccount);
        expect(r).toMatchObject({
            status: 409,
            body: { error: 'holds_earnings', claim_url: 'https://ochk.app/connect/claim#t=abc' },
        });
        expect(users()).toHaveLength(1);
    });

    it('live: while ochk.io can’t be reached, nothing is deleted here either', async () => {
        const b = await signedUp('ada@example.com', true);
        process.env.OCHK_CONNECT_KEY = 'occ_sk_test';
        await stubFetch({
            'https://ochk.io/api/connect/delete': () => new Response('down', { status: 502 }),
        });
        await b.call(reauth, { body: { password: PASSWORD } });
        expect((await b.call(deleteAccount)).body).toMatchObject({ error: 'connect_unavailable' });
        expect(users()).toHaveLength(1);
    });
});

describe('a deployment', () => {
    it('refuses to start without its origin and both keys, or on http', () => {
        vi.stubEnv('NODE_ENV', 'production');
        process.env.SITE_ORIGIN = 'https://example.com';
        expect(() => assertDeployable()).toThrow(/without OC_PROJECT_KEY, OC_SIGNING_SECRET/);
        process.env.OC_PROJECT_KEY = 'pk_live_x';
        expect(() => assertDeployable()).toThrow(/without OC_SIGNING_SECRET/);
        process.env.OC_SIGNING_SECRET = 'secret';
        expect(() => assertDeployable()).not.toThrow();
        process.env.SITE_ORIGIN = 'http://example.com';
        expect(() => assertDeployable()).toThrow(/must be https/);
        delete process.env.SITE_ORIGIN;
        expect(() => assertDeployable()).toThrow(/without SITE_ORIGIN/);
        vi.unstubAllEnvs();
    });
});
