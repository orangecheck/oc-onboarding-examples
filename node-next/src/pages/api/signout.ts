import { post } from '@/lib/http';
import { endSession } from '@/lib/sessions';

// The session is the site's own. The sign-in token was spent and ended at
// ochk.io when the session started, so there is nothing more to end there.
export default post((req, res) => {
    endSession(req, res);
    return res.status(200).json({ ok: true });
});
