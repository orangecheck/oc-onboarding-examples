import {
    CONNECT_CONSENT_BLURB,
    CONNECT_CONSENT_LABEL,
} from '@orangecheck/me-client/connect-consent';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';

import { postJson, sentence } from '@/components/api';
import { Layout, type ModeInfo } from '@/components/Layout';
import { cfg, type ConnectMode } from '@/lib/config';
import { connectConfigured } from '@/lib/connect';
import { pageContext } from '@/lib/page-props';

interface Props {
    info: ModeInfo;
    connect: ConnectMode | null;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => {
    const { info, user } = await pageContext(req);
    if (user) return { redirect: { destination: '/account', permanent: false } };
    return { props: { info, connect: connectConfigured() ? cfg().connectMode : null } };
};

export default function SignUp({ info, connect }: Props) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        const r = await postJson('/api/signup', {
            email: f.get('email'),
            password: f.get('password'),
            orangecheck: f.get('orangecheck') === 'on',
        });
        if (r.ok) return router.push('/account');
        setError(sentence(String(r.body.error ?? '')));
        setBusy(false);
    }

    return (
        <Layout title="Sign up" info={info} signedIn={false}>
            <h1>Sign up</h1>
            <form className="card stack" onSubmit={submit}>
                <label>
                    Email
                    <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        disabled={info.proofOnly}
                    />
                </label>
                <label>
                    Password
                    <input
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        minLength={10}
                        required
                        disabled={info.proofOnly}
                    />
                </label>
                {connect === 'opt-in' ? (
                    // Unticked by default, never bundled with anything else; the words are the SDK's.
                    <div className="consent">
                        <label className="check">
                            <input type="checkbox" name="orangecheck" disabled={info.proofOnly} />
                            {CONNECT_CONSENT_LABEL}
                        </label>
                        <p className="hint">{CONNECT_CONSENT_BLURB}</p>
                    </div>
                ) : connect === 'seamless' ? (
                    <p className="hint">
                        Signing up also makes you an orangecheck account. It stays with orangecheck
                        until you claim it at ochk.app, and this site gets an id for it, nothing
                        else about you.
                    </p>
                ) : null}
                {error ? <p className="error">{error}</p> : null}
                <button type="submit" disabled={busy || info.proofOnly}>
                    Sign up
                </button>
            </form>
            <p className="hint">
                Have an account? <Link href="/signin">Sign in</Link>
            </p>
        </Layout>
    );
}
