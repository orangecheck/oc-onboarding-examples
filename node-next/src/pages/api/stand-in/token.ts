import { cfg } from '@/lib/config';
import { body, post } from '@/lib/http';
import { standInToken } from '@/lib/stand-in';

// Offline mode: the stand-in popup asks for a token for a test person. It is
// issued to this site's origin only, as the real popup issues to its opener.
export default post(async (req, res) => {
    if (cfg().mode !== 'offline') return res.status(404).json({ ok: false, error: 'not_found' });
    const name = String(body(req).name ?? '')
        .trim()
        .slice(0, 40);
    if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
    return res.status(200).json({ ok: true, ...(await standInToken(name)) });
});
