import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
    // The project's domain token (ochk.app → your project → Domain), served in the
    // HTML your server sends, which is what the domain check reads.
    const verify = process.env.OC_DOMAIN_VERIFY?.trim();
    return (
        <Html lang="en">
            <Head>{verify ? <meta name="oc-domain-verify" content={verify} /> : null}</Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
