import { cfg } from '@/lib/config';
import { body, post } from '@/lib/http';
import { standInClaim } from '@/lib/stand-in';

// Offline mode: what ochk.app does when the person confirms a claim.
export default post((req, res) => {
    if (cfg().mode !== 'offline') return res.status(404).json({ ok: false, error: 'not_found' });
    const r = standInClaim(String(body(req).t ?? ''));
    return res
        .status(r.ok ? 200 : 410)
        .json(r.ok ? { ok: true } : { ok: false, error: 'link_used_or_expired' });
});
