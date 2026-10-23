import type { NextApiRequest, NextApiResponse } from 'next';

import { cfg } from './config';

export type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>;

/**
 * Every state change is a POST from this site's own pages. A browser sends
 * Sec-Fetch-Site on every request and no page can set it; Origin is the
 * fallback. A request that says neither is refused.
 */
export function sameOrigin(req: NextApiRequest): boolean {
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string') return site === 'same-origin';
    return req.headers.origin === cfg().siteOrigin;
}

/** POST only, from this site's own pages, then `handler`. */
export function post(handler: Handler): Handler {
    return async (req, res) => {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ ok: false, error: 'method_not_allowed' });
        }
        if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'cross_site' });
        return handler(req, res);
    };
}

export function body(req: NextApiRequest): Record<string, unknown> {
    return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}
