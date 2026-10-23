import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import { type FormEvent, useState } from 'react';

import { postJson } from '@/components/api';
import { cfg } from '@/lib/config';

// Offline mode: stands in for me.ochk.io/popup/signin. It answers its opener
// as the real popup does, with { type: 'oc-signin-success', account, token },
// posted to the opener's origin only.

interface Props {
    opener: string;
    allowed: boolean;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ query }) => {
    if (cfg().mode !== 'offline') return { notFound: true };
    const opener = String(query.opener_origin ?? '');
    return { props: { opener, allowed: opener === cfg().siteOrigin } };
};

export default function StandInPopup({ opener, allowed }: Props) {
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setBusy(true);
        const r = await postJson('/api/stand-in/token', {
            name: new FormData(e.currentTarget).get('name'),
        });
        if (r.ok && window.opener) {
            window.opener.postMessage(
                { type: 'oc-signin-success', account: r.body.account, token: r.body.token },
                opener,
            );
        }
        setBusy(false);
    }

    return (
        <main className="popup">
            <Head>
                <title>Stand-in sign-in</title>
            </Head>
            <h1>Stand-in for orangecheck’s sign-in</h1>
            <p className="hint">
                Offline mode. The real popup signs people in with a Bitcoin wallet, email, Google or
                GitHub. Here, name a test person; the same name comes back as the same orangecheck
                account.
            </p>
            {allowed ? (
                <form className="stack" onSubmit={submit}>
                    <label>
                        Test person
                        <input name="name" defaultValue="Ada" required maxLength={40} />
                    </label>
                    <button type="submit" disabled={busy}>
                        Sign in
                    </button>
                </form>
            ) : (
                <p className="error">This stand-in only signs in to this site.</p>
            )}
        </main>
    );
}
