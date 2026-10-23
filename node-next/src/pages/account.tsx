import {
    CONNECT_CONSENT_BLURB,
    CONNECT_CONSENT_LABEL,
} from '@orangecheck/me-client/connect-consent';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useState } from 'react';

import { postJson, sentence } from '@/components/api';
import { Layout, type ModeInfo } from '@/components/Layout';
import { OrangecheckButton } from '@/components/OrangecheckButton';
import { connectConfigured } from '@/lib/connect';
import { connectFor, freshEnough } from '@/lib/guard';
import { pageContext } from '@/lib/page-props';
import { linkedDid } from '@/lib/users';

interface Props {
    info: ModeInfo;
    email: string | null;
    hasPassword: boolean;
    fresh: boolean;
    linked: string | null;
    connect: null | { did: string | null; consent: boolean; claimed: boolean };
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => {
    const { info, session, user } = await pageContext(req);
    if (!session || !user) return { redirect: { destination: '/signin', permanent: false } };
    const linked = linkedDid(user.id);
    return {
        props: {
            info,
            email: user.email,
            hasPassword: Boolean(user.password_hash),
            fresh: freshEnough(session, user),
            linked,
            connect:
                connectConfigured() && (connectFor(user, linked) || user.connect_did)
                    ? {
                          did: user.connect_did,
                          consent: user.connect_consent === 1,
                          claimed: user.connect_claimed === 1,
                      }
                    : null,
        },
    };
};

function useAction() {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    async function run(
        path: string,
        data?: unknown,
        onOk?: (body: Record<string, unknown>) => void,
    ) {
        setBusy(true);
        setError(null);
        const r = await postJson(path, data);
        if (r.ok) {
            if (onOk) onOk(r.body);
            else window.location.reload();
            return;
        }
        setError(sentence(String(r.body.error ?? '')));
        setBusy(false);
        return r.body;
    }
    return { error, busy, run, setError };
}

export default function Account({ info, email, hasPassword, fresh, linked, connect }: Props) {
    const router = useRouter();
    const a = useAction();
    const [ticked, setTicked] = useState(false);
    const [claimUrl, setClaimUrl] = useState<string | null>(null);
    const reauth = '/reauth?next=/account';

    return (
        <Layout title="Your account" info={info} signedIn>
            <h1>Your account</h1>
            {a.error ? <p className="error">{a.error}</p> : null}

            <section className="card stack">
                <h2>You</h2>
                <p>{email ?? 'You sign in with orangecheck only.'}</p>
                <p className="actions">
                    <button
                        type="button"
                        className="quiet"
                        disabled={a.busy}
                        onClick={() => a.run('/api/signout', {}, () => router.push('/'))}
                    >
                        Sign out
                    </button>
                </p>
            </section>

            {connect ? (
                <section className="card stack">
                    <h2>Your orangecheck account</h2>
                    {connect.did ? (
                        <>
                            <p>
                                <code>{connect.did}</code>
                            </p>
                            <p className="hint">
                                {connect.claimed
                                    ? 'You claimed it at ochk.app: it is yours, and works on other sites.'
                                    : 'Made by Connect. It stays with orangecheck until you claim it at ochk.app.'}
                            </p>
                            {!connect.claimed ? (
                                <p className="actions">
                                    <button
                                        type="button"
                                        disabled={a.busy}
                                        onClick={() =>
                                            a.run('/api/connect/claim-link', {}, (b) =>
                                                window.location.assign(String(b.url)),
                                            )
                                        }
                                    >
                                        Claim it at ochk.app
                                    </button>
                                </p>
                            ) : null}
                        </>
                    ) : null}
                    {!connect.did || !connect.consent ? (
                        <div className="consent stack">
                            <label className="check">
                                <input
                                    type="checkbox"
                                    checked={ticked}
                                    onChange={(e) => setTicked(e.target.checked)}
                                />
                                {CONNECT_CONSENT_LABEL}
                            </label>
                            <p className="hint">{CONNECT_CONSENT_BLURB}</p>
                            <p className="actions">
                                <button
                                    type="button"
                                    disabled={!ticked || a.busy}
                                    onClick={() =>
                                        a.run('/api/connect/provision', { orangecheck: true })
                                    }
                                >
                                    {connect.did ? 'Save' : 'Create it'}
                                </button>
                            </p>
                        </div>
                    ) : null}
                </section>
            ) : null}

            <section className="card stack">
                <h2>Sign in with orangecheck</h2>
                {linked ? (
                    <>
                        <p>
                            Linked: <code>{linked}</code>
                        </p>
                        {hasPassword ? (
                            fresh ? (
                                <p className="actions">
                                    <button
                                        type="button"
                                        className="quiet"
                                        disabled={a.busy}
                                        onClick={() => a.run('/api/account/unlink')}
                                    >
                                        Unlink orangecheck
                                    </button>
                                </p>
                            ) : (
                                <p className="hint">
                                    To unlink it, <Link href={reauth}>confirm your password</Link>{' '}
                                    first.
                                </p>
                            )
                        ) : null}
                    </>
                ) : hasPassword ? (
                    fresh ? (
                        <OrangecheckButton
                            offline={info.mode === 'offline'}
                            endpoint="/api/account/link"
                            label="Link orangecheck"
                            then="/account"
                        />
                    ) : (
                        <p className="hint">
                            Link orangecheck to sign in with it here.{' '}
                            <Link href={reauth}>Confirm your password</Link> first.
                        </p>
                    )
                ) : null}
            </section>

            <section className="card stack">
                <h2>Your own keys</h2>
                <p className="hint">
                    Not open yet. orangecheck holds every key that can move funds while the system
                    is in testing. Signing in with your own Bitcoin wallet is self-custody of that
                    key today; it does not move what you earn. See{' '}
                    <a href="https://ochk.app/custody">ochk.app/custody</a>.
                </p>
            </section>

            <section className="card stack">
                <h2>Delete your account</h2>
                {claimUrl ? (
                    <p>
                        Your orangecheck account holds earnings, so it stays.{' '}
                        <a href={claimUrl}>Claim it</a> before you go.
                    </p>
                ) : fresh ? (
                    <p className="actions">
                        <button
                            type="button"
                            className="danger"
                            disabled={a.busy}
                            onClick={async () => {
                                const body = await a.run('/api/account/delete', {}, () =>
                                    router.push('/'),
                                );
                                if (body?.claim_url) setClaimUrl(String(body.claim_url));
                            }}
                        >
                            Delete my account
                        </button>
                    </p>
                ) : (
                    <p className="hint">
                        <Link href={reauth}>Confirm your password</Link> first.
                    </p>
                )}
            </section>
        </Layout>
    );
}
