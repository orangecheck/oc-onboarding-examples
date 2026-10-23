// The weekly live check of Connect, against a test project, with its Connect
// key only: provision, a later tick, a claim link, delete, and the refusal a
// deleted user gets. A fresh user id each run, so last week's refusal never
// meets this week's provision. Prints no key and no claim token.
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

import { connectClaimLink, connectDelete, connectProvision } from '@orangecheck/me-client/server';

const apiKey = process.env.OCHK_CONNECT_KEY?.trim();
if (!apiKey) {
    console.error('OCHK_CONNECT_KEY is not set.');
    process.exit(1);
}

const userId = `smoke-${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`;
const rows = [];
let failed = false;

function check(step, ok, seen) {
    rows.push(`| ${step} | ${ok ? 'pass' : 'FAIL'} | ${seen} |`);
    console.log(`${ok ? 'pass' : 'FAIL'}  ${step}: ${seen}`);
    if (!ok) failed = true;
    return ok;
}

const shape = (r) => (r.ok ? JSON.stringify({ ...r, url: undefined }) : `${r.status} ${r.reason}`);

let deleted = false;
try {
    const a = await connectProvision({ apiKey, userId });
    if (!check('provision, no box', a.ok && a.is_new === true, shape(a))) throw new Error('stop');

    const b = await connectProvision({ apiKey, userId, consent: true });
    check(
        'a later tick keeps the account',
        b.ok && b.did_oc === a.did_oc && b.is_new === false,
        shape(b),
    );

    const c = await connectClaimLink({ apiKey, userId });
    const at = c.ok ? new URL(c.url) : null;
    check(
        'claim link',
        Boolean(
            at &&
            at.origin === 'https://ochk.app' &&
            at.pathname === '/connect/claim' &&
            at.hash.length > 3,
        ),
        c.ok ? `${at.origin}${at.pathname}, expires ${c.expires_at}` : shape(c),
    );

    const d = await connectDelete({ apiKey, userId });
    deleted = d.ok;
    check('delete, unclaimed', d.ok && d.result === 'deleted', shape(d));

    const e = await connectProvision({ apiKey, userId });
    check(
        'no box after a delete is refused',
        !e.ok && e.status === 410 && e.reason === 'account_deleted',
        shape(e),
    );
} catch (err) {
    if (err.message !== 'stop') check('no exception', false, err.message);
} finally {
    if (!deleted) {
        const d = await connectDelete({ apiKey, userId });
        check('clean up', d.ok, shape(d));
    }
}

if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
            '### Connect, live',
            '',
            '| Step | Result | Seen |',
            '| --- | --- | --- |',
            ...rows,
            '',
        ].join('\n'),
    );
}
process.exit(failed ? 1 : 0);
