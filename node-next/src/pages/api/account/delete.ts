import { claimLink, deleteConnect } from '@/lib/connect';
import { freshEnough, signedIn } from '@/lib/guard';
import { post } from '@/lib/http';
import { endSession } from '@/lib/sessions';
import { deleteUser } from '@/lib/users';

// Delete the account. The orangecheck account Connect made for them goes first
// (ochk.io/docs/connect#when-your-user-deletes-their-account): unclaimed, it is
// deleted; claimed, it is theirs and only detaches. One that earned stays, and
// the person gets a claim link before they go.
export default post(async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    if (!freshEnough(who.session, who.user)) {
        return res.status(403).json({ ok: false, error: 'confirm_password_first' });
    }
    if (who.user.connect_did) {
        const r = await deleteConnect(who.user.id);
        if (!r.ok) {
            if (r.reason === 'holds_earnings') {
                const link = await claimLink(who.user.id);
                return res.status(409).json({
                    ok: false,
                    error: 'holds_earnings',
                    claim_url: link.ok ? link.url : null,
                });
            }
            // Not deleted there, so not here either: never leave an account nobody can reach.
            return res.status(503).json({ ok: false, error: 'connect_unavailable' });
        }
    }
    deleteUser(who.user.id);
    endSession(req, res);
    return res.status(200).json({ ok: true });
});
