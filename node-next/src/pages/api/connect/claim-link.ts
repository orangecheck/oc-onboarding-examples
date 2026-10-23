import { claimLink } from '@/lib/connect';
import { signedIn } from '@/lib/guard';
import { post } from '@/lib/http';

// A claim link, minted for the signed-in user only, at the moment they ask.
// It works once, for fifteen minutes; the page sends them straight to it.
export default post(async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    if (!who.user.connect_did)
        return res.status(404).json({ ok: false, error: 'no_connect_account' });
    const r = await claimLink(who.user.id);
    if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.reason });
    return res.status(200).json({ ok: true, url: r.url });
});
