import { freshEnough, signedIn } from '@/lib/guard';
import { post } from '@/lib/http';
import { tellAccount, unlinkDid } from '@/lib/users';

// Unlink after a fresh sign-in with the site's own login. Every session the
// did started here ends with it.
export default post(async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    if (!who.user.password_hash)
        return res.status(400).json({ ok: false, error: 'no_other_login' });
    if (!freshEnough(who.session, who.user)) {
        return res.status(403).json({ ok: false, error: 'confirm_password_first' });
    }
    const did = unlinkDid(who.user.id);
    if (!did) return res.status(404).json({ ok: false, error: 'not_linked' });
    tellAccount(who.user, `orangecheck ${did} was unlinked from your account.`);
    return res.status(200).json({ ok: true });
});
