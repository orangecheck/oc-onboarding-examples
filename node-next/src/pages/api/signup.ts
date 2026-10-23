import { cfg } from '@/lib/config';
import { connectConfigured, provision } from '@/lib/connect';
import { body, post } from '@/lib/http';
import { hashPassword } from '@/lib/passwords';
import { startSession } from '@/lib/sessions';
import { createPasswordUser, setConnect, userByEmail } from '@/lib/users';

// Sign up with the site's own login. With Connect on, this is where the person
// gets an orangecheck account: always ("seamless"), or only when they ticked
// the box ("opt-in"). It never blocks the sign-up: a refusal is a result.
export default post(async (req, res) => {
    const b = body(req);
    const email = String(b.email ?? '')
        .trim()
        .toLowerCase();
    const password = String(b.password ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ ok: false, error: 'bad_email' });
    }
    if (password.length < 10) return res.status(400).json({ ok: false, error: 'short_password' });
    if (userByEmail(email)) return res.status(409).json({ ok: false, error: 'email_taken' });

    const user = createPasswordUser(email, await hashPassword(password));
    startSession(res, user.id, 'password');

    let connect: string | null = null;
    if (connectConfigured()) {
        const seamless = cfg().connectMode === 'seamless';
        const ticked = b.orangecheck === true;
        // Unticked means no call at all; `consent` goes only with a tick.
        if (seamless || ticked) {
            const r = await provision(user.id, !seamless && ticked);
            if (r.ok) setConnect(user.id, r.did_oc, !seamless && ticked);
            connect = r.ok ? 'created' : r.reason;
        }
    }
    return res.status(200).json({ ok: true, connect });
});
