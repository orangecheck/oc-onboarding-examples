import { safeReturnPath } from '@orangecheck/me-client';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { type FormEvent, useState } from 'react';

import { postJson, sentence } from '@/components/api';
import { Layout, type ModeInfo } from '@/components/Layout';
import { pageContext } from '@/lib/page-props';

interface Props {
    info: ModeInfo;
    next: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req, query }) => {
    const { info, user } = await pageContext(req);
    if (!user) return { redirect: { destination: '/signin', permanent: false } };
    return { props: { info, next: safeReturnPath(query.next, '/account') } };
};

export default function Reauth({ info, next }: Props) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const r = await postJson('/api/reauth', {
            password: new FormData(e.currentTarget).get('password'),
        });
        if (r.ok) return router.push(next);
        setError(sentence(String(r.body.error ?? '')));
    }

    return (
        <Layout title="Confirm your password" info={info} signedIn>
            <h1>Confirm your password</h1>
            <p className="lead">Linking, unlinking and deleting ask for your own password first.</p>
            <form className="card stack" onSubmit={submit}>
                <label>
                    Password
                    <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        disabled={info.proofOnly}
                    />
                </label>
                {error ? <p className="error">{error}</p> : null}
                <button type="submit" disabled={info.proofOnly}>
                    Confirm
                </button>
            </form>
        </Layout>
    );
}
