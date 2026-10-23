import type { GetServerSideProps } from 'next';
import Link from 'next/link';

import { Layout, type ModeInfo } from '@/components/Layout';
import { pageContext } from '@/lib/page-props';

interface Props {
    info: ModeInfo;
    signedIn: boolean;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => {
    const { info, user } = await pageContext(req);
    return { props: { info, signedIn: Boolean(user) } };
};

export default function Home({ info, signedIn }: Props) {
    return (
        <Layout title="Home" info={info} signedIn={signedIn}>
            <h1>A site with its own login, and orangecheck behind it.</h1>
            <p className="lead">
                This is a reference: fork it, run it, and read how each step works. It walks the
                whole funnel a person meets.
            </p>
            <ol className="funnel">
                <li>
                    <strong>Sign up with this site’s own login.</strong> An email and a password,
                    kept here.
                </li>
                <li>
                    <strong>Get an orangecheck account through Connect.</strong> Without asking, or
                    with an opt-in box: you choose which.
                </li>
                <li>
                    <strong>Claim it at ochk.app.</strong> Then it is the person’s, to use on other
                    sites or delete.
                </li>
                <li>
                    <strong>Sign in with orangecheck.</strong> On its own, or linked to the account
                    they already have here.
                </li>
                <li>
                    <strong>Move to their own keys.</strong> Not open yet: orangecheck holds every
                    key that can move funds while the system is in testing. See{' '}
                    <a href="https://ochk.app/custody">ochk.app/custody</a>.
                </li>
            </ol>
            <p className="actions">
                {signedIn ? (
                    <Link className="button" href="/account">
                        Your account
                    </Link>
                ) : (
                    <>
                        <Link className="button" href="/signup">
                            Sign up
                        </Link>
                        <Link className="button quiet" href="/signin">
                            Sign in
                        </Link>
                    </>
                )}
            </p>
        </Layout>
    );
}
