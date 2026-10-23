import { connectConfigured, provision } from '@/lib/connect';
import { connectFor, signedIn } from '@/lib/guard';
import { body, post } from '@/lib/http';
import { linkedDid, setConnect } from '@/lib/users';

// "Also create my orangecheck account", ticked on the account page. A tick is
// consent, recorded once; it also upgrades an account made without asking.
export default post(async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    if (!connectConfigured())
        return res.status(503).json({ ok: false, error: 'connect_not_configured' });
    // Someone who signs in with orangecheck already has an account: provisioning makes a second.
    if (!connectFor(who.user, linkedDid(who.user.id))) {
        return res.status(409).json({ ok: false, error: 'has_orangecheck_already' });
    }
    if (body(req).orangecheck !== true)
        return res.status(400).json({ ok: false, error: 'not_ticked' });
    const r = await provision(who.user.id, true);
    if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.reason });
    setConnect(who.user.id, r.did_oc, true);
    return res.status(200).json({ ok: true, did_oc: r.did_oc });
});
