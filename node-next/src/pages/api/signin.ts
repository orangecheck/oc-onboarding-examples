import { normalizeEmail } from '@orangecheck/auth-core/identifiers';

import { body, post } from '@/lib/http';
import { checkPassword, hashPassword } from '@/lib/passwords';
import { startSession } from '@/lib/sessions';
import { userByEmail } from '@/lib/users';

const DECOY = hashPassword('not anyone’s password');

export default post(async (req, res) => {
    const b = body(req);
    const user = userByEmail(normalizeEmail(String(b.email ?? '')));
    // Hash either way, so an unknown address takes as long as a wrong password.
    const ok = await checkPassword(String(b.password ?? ''), user?.password_hash ?? (await DECOY));
    if (!user || !ok) return res.status(401).json({ ok: false, error: 'wrong_email_or_password' });
    startSession(res, user.id, 'password');
    return res.status(200).json({ ok: true });
});
