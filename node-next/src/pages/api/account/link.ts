import { freshEnough, signedIn } from '@/lib/guard';
import { post } from '@/lib/http';
import { endTokenAtOrangecheck, spendToken, withSignInToken } from '@/lib/orangecheck';
import { linkDid, tellAccount } from '@/lib/users';

// Link orangecheck to an account that has its own login, after a fresh sign-in
// with that login. One did per account; a did another user has is refused.
export default post(
    withSignInToken(async (req, res, token) => {
        const who = await signedIn(req, res);
        if (!who) return;
        if (!who.user.password_hash || !freshEnough(who.session, who.user)) {
            return res.status(403).json({ ok: false, error: 'confirm_password_first' });
        }
        const s = req.ocSession!;
        if (!s.exp || !(await spendToken(s.jti, s.exp))) {
            return res.status(401).json({ ok: false, error: 'token_spent' });
        }
        const result = linkDid(who.user.id, s.did_oc);
        await endTokenAtOrangecheck(token, s.exp);
        if (result !== 'linked') return res.status(409).json({ ok: false, error: result });
        tellAccount(who.user, `orangecheck ${s.did_oc} was linked to your account.`);
        return res.status(200).json({ ok: true, did_oc: s.did_oc });
    }),
);
