import type { NextApiRequest, NextApiResponse } from 'next';

import { cfg } from '@/lib/config';
import { standInJwks } from '@/lib/stand-in';

// Offline mode: the stand-in issuer's key set, served at
// /stand-in/.well-known/jwks.json (next.config.ts rewrites it here).
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
    if (cfg().mode !== 'offline') return res.status(404).json({ ok: false, error: 'not_found' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(await standInJwks());
}
