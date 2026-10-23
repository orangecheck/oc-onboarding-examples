import { signedIn } from '@/lib/guard';
import { body, post } from '@/lib/http';
import { checkPassword } from '@/lib/passwords';
import { endSession, startSession } from '@/lib/sessions';

// A fresh sign-in with the site's own login: a new password session, good for
// linking, unlinking and deleting for five minutes. Never one the did started.
export default post(async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    if (!who.user.password_hash) return res.status(400).json({ ok: false, error: 'no_password' });
    if (!(await checkPassword(String(body(req).password ?? ''), who.user.password_hash))) {
        return res.status(401).json({ ok: false, error: 'wrong_password' });
    }
    endSession(req, res);
    startSession(res, who.user.id, 'password', undefined, true);
    return res.status(200).json({ ok: true });
});
