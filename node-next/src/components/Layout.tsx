import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { Mode } from '@/lib/config';

export interface ModeInfo {
    mode: Mode;
    endedSessionsChecked: boolean;
    /** The Vercel copy: it proves the domain and takes the webhook; nobody signs in. */
    proofOnly: boolean;
}

const RUN_IT =
    'https://github.com/orangecheck/oc-onboarding-examples/tree/main/node-next#run-it-offline';

/** The frame every page shares: the site's name, its links, and which orangecheck it talks to. */
export function Layout({
    title,
    info,
    signedIn,
    children,
}: {
    title: string;
    info: ModeInfo;
    signedIn: boolean;
    children: ReactNode;
}) {
    return (
        <>
            <Head>
                <title>{`${title} · Example site`}</title>
                <meta name="robots" content="noindex" />
            </Head>
            <header className="top">
                <Link href="/" className="brand">
                    Example site
                </Link>
                <nav>
                    {signedIn ? (
                        <Link href="/account">Your account</Link>
                    ) : (
                        <Link href="/signin">Sign in</Link>
                    )}
                </nav>
            </header>
            {info.proofOnly ? (
                <p className="banner" role="status">
                    This copy only proves the domain. <a href={RUN_IT}>Run it yourself</a> to sign
                    in.
                </p>
            ) : info.mode === 'offline' ? (
                <p className="banner">
                    Offline mode. Nothing here talks to orangecheck: sign-in, Connect and claiming
                    run against stand-ins in this repo. Add your keys to <code>.env</code> to run it
                    live.
                </p>
            ) : !info.endedSessionsChecked ? (
                <p className="banner">
                    Live, without <code>OC_SIGNING_SECRET</code>: a session someone ends everywhere
                    is not refused here. Set it, with your test project&apos;s development origin
                    declared on localhost; a deployment refuses to start without it.
                </p>
            ) : null}
            <main>{children}</main>
        </>
    );
}
