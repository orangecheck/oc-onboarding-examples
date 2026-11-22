import { webhook } from '@orangecheck/me-client';
import type { NextApiRequest, NextApiResponse } from 'next';

import { cfg } from '@/lib/config';
import { markConnectClaimed } from '@/lib/users';

// Your project's webhooks (ochk.io/docs/me/webhooks). The one this site acts on
// is connect.claimed: the person claimed the account Connect made for them.
// The signature is over the raw bytes, so Next must not parse the body. One key
// signs every project's deliveries, so verify with this project's key: another
// project's delivery, or one more than a day old, is refused. Marking an account
// claimed twice changes nothing, so this site keeps no delivery ids.
export const config = { api: { bodyParser: false } };

async function raw(req: NextApiRequest): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { mode, projectKey } = cfg();
    if (mode !== 'live' || !projectKey)
        return res.status(404).json({ ok: false, error: 'not_found' });
    if (req.method !== 'POST') return res.status(405).end();
    const text = await raw(req);
    const sig = req.headers['oc-signature'];
    const kid = req.headers['oc-key-id'];
    const v = await webhook.verify(
        text,
        typeof sig === 'string' ? sig : undefined,
        typeof kid === 'string' ? kid : undefined,
        { project: projectKey },
    );
    if (!v.ok) return res.status(401).json({ ok: false, error: v.reason });
    const event = JSON.parse(text) as { subtype?: string; did_oc?: string };
    if (event.subtype === 'connect.claimed' && event.did_oc) markConnectClaimed(event.did_oc);
    return res.status(200).json({ ok: true });
}
