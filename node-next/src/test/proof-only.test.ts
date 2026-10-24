import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GetServerSidePropsContext } from 'next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SignIn, { getServerSideProps } from '@/pages/signin';

vi.mock('next/router', () => ({ useRouter: () => ({ push: () => undefined }) }));

const NOTICE = 'This copy only proves the domain.';

async function signInPage(): Promise<string> {
    const req = { headers: {}, method: 'GET' } as IncomingMessage;
    const ctx = { req, res: {} as ServerResponse, query: {}, resolvedUrl: '/signin' };
    const r = await getServerSideProps(ctx as unknown as GetServerSidePropsContext);
    if (!('props' in r)) throw new Error('signin did not render');
    return renderToStaticMarkup(createElement(SignIn, await r.props));
}

const controls = (html: string) => [...html.matchAll(/<(input|button)\b[^>]*>/g)].map((m) => m[0]);

describe('the Vercel copy', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('says it only proves the domain, and every way to sign in is shown but off', async () => {
        vi.stubEnv('VERCEL', '1');
        const html = await signInPage();
        expect(html).toContain(NOTICE);
        expect(html).toMatch(
            /href="https:\/\/github\.com\/orangecheck\/oc-onboarding-examples\/tree\/main\/node-next#run-it-offline"/,
        );
        const all = controls(html);
        expect(all.length).toBeGreaterThanOrEqual(4);
        for (const c of all) expect(c, c).toMatch(/\sdisabled=""/);
        // orangecheck's button is still there, with its mark and its words.
        expect(html).toMatch(
            /<button[^>]*data-oc-sign-in=""[^>]*disabled=""[^>]*>[\s\S]*?data-oc-mark="mono"[\s\S]*?Sign in with orangecheck<\/span><\/button>|<button[^>]*disabled=""[^>]*data-oc-sign-in=""[^>]*>[\s\S]*?data-oc-mark="mono"[\s\S]*?Sign in with orangecheck<\/span><\/button>/,
        );
    });

    it('anywhere else, there is no notice and nothing is off', async () => {
        vi.stubEnv('VERCEL', '');
        const html = await signInPage();
        expect(html).not.toContain(NOTICE);
        const all = controls(html);
        expect(all.length).toBeGreaterThanOrEqual(4);
        for (const c of all) expect(c, c).not.toMatch(/\sdisabled=""/);
    });
});
