import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

const HEADERS = [
    // The sign-in popup answers this page with postMessage, so the page must
    // keep its opener: same-origin-allow-popups, never same-origin.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    // Not in dev: next dev serves one of its own scripts as JSON.
    ...(dev ? [] : [{ key: 'X-Content-Type-Options', value: 'nosniff' }]),
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
        key: 'Content-Security-Policy',
        value: [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "connect-src 'self'",
            "form-action 'self'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
        ].join('; '),
    },
];

const nextConfig: NextConfig = {
    reactStrictMode: true,
    agentRules: false,
    poweredByHeader: false,
    async headers() {
        return [{ source: '/(.*)', headers: HEADERS }];
    },
    async rewrites() {
        // Offline mode: the stand-in issuer's key set, where verifyOcToken looks for it.
        return [{ source: '/stand-in/.well-known/jwks.json', destination: '/api/stand-in/jwks' }];
    },
};

export default nextConfig;
