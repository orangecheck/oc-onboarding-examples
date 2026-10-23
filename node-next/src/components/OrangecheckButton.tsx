import { signInWithOcOutcome } from '@orangecheck/me-client/popup';
import { useRouter } from 'next/router';
import { useState } from 'react';

import { postJson, sentence } from './api';

/**
 * Opens orangecheck's sign-in popup (in offline mode, the stand-in at
 * /stand-in/popup) and sends the token it hands back to `endpoint`, once, as a
 * Bearer header. The token is never kept in the page.
 */
export function OrangecheckButton({
    offline,
    endpoint,
    label,
    then,
}: {
    offline: boolean;
    endpoint: string;
    label: string;
    then: string;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function go() {
        setBusy(true);
        setError(null);
        const outcome = await signInWithOcOutcome(
            offline ? { popupOrigin: window.location.origin, popupPath: '/stand-in/popup' } : {},
        );
        if (outcome.status === 'blocked')
            setError(
                'Your browser blocked the window. Allow pop-ups for this site, then try again.',
            );
        if (outcome.status === 'signed_in') {
            const r = await postJson(endpoint, {}, { Authorization: `Bearer ${outcome.token}` });
            if (r.ok) return router.push(then);
            setError(sentence(String(r.body.error ?? r.body.reason ?? '')));
        }
        setBusy(false);
    }

    return (
        <div className="stack">
            <button type="button" className="oc" onClick={go} disabled={busy}>
                {busy ? 'Waiting for orangecheck…' : label}
            </button>
            {error ? <p className="error">{error}</p> : null}
        </div>
    );
}
