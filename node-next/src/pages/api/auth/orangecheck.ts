import { cfg } from '@/lib/config';
import { post } from '@/lib/http';
import { endTokenAtOrangecheck, spendToken, withSignInToken } from '@/lib/orangecheck';
import { startSession } from '@/lib/sessions';
import { userForFirstSignIn } from '@/lib/users';

// Sign in with orangecheck. The token arrives once, verified and held to the
// project's sign-in rule by the wrapper; it starts one session here, its jti is
// spent, and it is ended at ochk.io. The site's own session takes over.
export default post(
    withSignInToken(async (req, res, token) => {
        const s = req.ocSession!;
        // withOcAuth refused a token without rh: nothing could end its session.
        const rh = s.rh!;
        if (!s.exp || !s.iat || !(await spendToken(s.jti, s.exp))) {
            return res.status(401).json({ ok: false, error: 'token_spent' });
        }
        const aud = cfg().siteOrigin;
        const user = userForFirstSignIn(s.did_oc);
        startSession(res, user.id, 'orangecheck', { did_oc: s.did_oc, rh, aud, iat: s.iat });
        await endTokenAtOrangecheck(token, s.exp);
        return res.status(200).json({ ok: true });
    }),
);
