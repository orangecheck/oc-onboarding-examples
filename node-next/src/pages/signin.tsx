import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';

import { postJson, sentence } from '@/components/api';
import { Layout, type ModeInfo } from '@/components/Layout';
import { OrangecheckButton } from '@/components/OrangecheckButton';
import { pageContext } from '@/lib/page-props';

interface Props {
    info: ModeInfo;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => {
    const { info, user } = await pageContext(req);
    if (user) return { redirect: { destination: '/account', permanent: false } };
    return { props: { info } };
};

export default function SignIn({ info }: Props) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        const r = await postJson('/api/signin', {
            email: f.get('email'),
            password: f.get('password'),
        });
        if (r.ok) return router.push('/account');
        setError(sentence(String(r.body.error ?? '')));
        setBusy(false);
    }

    return (
        <Layout title="Sign in" info={info} signedIn={false}>
            <h1>Sign in</h1>
            <form className="card stack" onSubmit={submit}>
                <label>
                    Email
                    <input name="email" type="email" autoComplete="email" required />
                </label>
                <label>
                    Password
                    <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                    />
                </label>
                {error ? <p className="error">{error}</p> : null}
                <button type="submit" disabled={busy}>
                    Sign in
                </button>
            </form>
            <div className="card stack">
                <OrangecheckButton
                    offline={info.mode === 'offline'}
                    endpoint="/api/auth/orangecheck"
                    label="Sign in with orangecheck"
                    then="/account"
                />
                <p className="hint">
                    A Bitcoin wallet, email, Google or GitHub. This site gets an id for you, not
                    your address.
                </p>
            </div>
            <p className="hint">
                New here? <Link href="/signup">Sign up</Link>
            </p>
        </Layout>
    );
}
