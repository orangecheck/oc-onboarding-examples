import type { GetServerSidePropsContext } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { safeNext } from '@/lib/safe-next';
import signup from '@/pages/api/signup';
import { getServerSideProps } from '@/pages/reauth';

import { Browser, offlineSite, stubFetch } from './harness';

vi.mock('next/router', () => ({ useRouter: () => ({ push: () => undefined }) }));
afterEach(() => vi.unstubAllGlobals());

// Every one of these leaves the site once a browser has read it.
const REFUSED = [
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r//evil.com',
    '//1249741522',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    '/..//evil.com',
    '/%2e%2e//evil.com',
    '/%2E./evil.com',
    '/a/../account',
    '/./account',
    '/\u0000/evil.com',
    '/\u007f/evil.com',
    'evil.com',
    '',
];

describe('safeNext', () => {
    it.each(REFUSED.map((raw) => [JSON.stringify(raw), raw]))('refuses %s', (_, raw) => {
        expect(safeNext(raw)).toBe('/account');
    });

    it('keeps a path on this site', () => {
        expect(safeNext('/account')).toBe('/account');
        expect(safeNext('/account/delete?step=2#confirm')).toBe('/account/delete?step=2#confirm');
        expect(safeNext('/account?from=/a/../b')).toBe('/account?from=/a/../b');
    });

    it('answers the fallback for anything that is not text', () => {
        for (const raw of [undefined, null, 42, ['/account']])
            expect(safeNext(raw)).toBe('/account');
    });
});

describe('the re-auth page', () => {
    it('sends an off-site next back to /account', async () => {
        offlineSite();
        await stubFetch();
        const b = new Browser();
        const body = { email: 'ada@example.com', password: 'correct horse battery' };
        expect((await b.call(signup, { body })).status).toBe(200);
        const nextFor = async (next: string) => {
            const req = { headers: { cookie: b.cookie }, method: 'GET' };
            const ctx = { req, res: {}, query: { next }, resolvedUrl: '/reauth' };
            const r = await getServerSideProps(ctx as unknown as GetServerSidePropsContext);
            return 'props' in r ? (await r.props).next : null;
        };
        expect(await nextFor('/\t/evil.com')).toBe('/account');
        expect(await nextFor('/account/delete')).toBe('/account/delete');
    });
});
