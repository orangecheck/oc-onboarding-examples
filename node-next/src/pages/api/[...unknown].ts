import type { NextApiRequest, NextApiResponse } from 'next';

/** An API address this site does not serve: JSON, not a page. */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    return res.status(404).json({ ok: false, error: 'not_found' });
}
