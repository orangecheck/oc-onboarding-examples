import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';

import { postJson } from '@/components/api';
import { cfg } from '@/lib/config';

// Offline mode: stands in for ochk.app/connect/claim. The link's token is in
// the URL fragment, as on ochk.app, so it reaches no server log.

export const getServerSideProps: GetServerSideProps = async () =>
    cfg().mode === 'offline' ? { props: {} } : { notFound: true };

export default function StandInClaim() {
    const [state, setState] = useState<'ready' | 'claimed' | 'failed'>('ready');

    async function claim() {
        const t = new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';
        const r = await postJson('/api/stand-in/claim', { t });
        setState(r.ok ? 'claimed' : 'failed');
    }

    return (
        <main className="popup">
            <Head>
                <title>Stand-in claim</title>
            </Head>
            <h1>Stand-in for claiming at ochk.app</h1>
            <p className="hint">
                On ochk.app the person signs in, sees what the account holds, and confirms with a
                passkey tap, an emailed code or a wallet signature. Then the account is theirs, and
                your site hears <code>connect.claimed</code>.
            </p>
            {state === 'ready' ? (
                <button type="button" onClick={claim}>
                    Confirm the claim
                </button>
            ) : state === 'claimed' ? (
                <p>
                    Claimed. <Link href="/account">Back to your account</Link>
                </p>
            ) : (
                <p className="error">
                    This link was used or has expired.{' '}
                    <Link href="/account">Back to your account</Link>
                </p>
            )}
        </main>
    );
}
