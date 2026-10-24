import { OUTCOME_COPY, SignInWithOrangecheck } from '@orangecheck/me-client/react';
import { useState } from 'react';

import { postJson, sentence } from './api';

/**
 * orangecheck's own button from the SDK, in this site's button style (class "oc";
 * the SDK's inherit appearance adds the mark and nothing else). It opens
 * orangecheck's sign-in popup (in offline mode, the stand-in at /stand-in/popup)
 * and sends the token it hands back to `endpoint`, once, as a Bearer header. The
 * token is never kept in the page.
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
    const [error, setError] = useState<string | null>(null);

    return (
        <div className="stack">
            <SignInWithOrangecheck
                className="oc"
                label={label}
                popup={
                    offline && typeof window !== 'undefined'
                        ? { popupOrigin: window.location.origin, popupPath: '/stand-in/popup' }
                        : undefined
                }
                onOutcome={(outcome) =>
                    setError(
                        outcome.status in OUTCOME_COPY
                            ? OUTCOME_COPY[outcome.status as keyof typeof OUTCOME_COPY]
                            : null,
                    )
                }
                onSignedIn={async ({ token }) => {
                    const r = await postJson(endpoint, {}, { Authorization: `Bearer ${token}` });
                    if (r.ok) return window.location.assign(then);
                    setError(sentence(String(r.body.error ?? r.body.reason ?? '')));
                }}
            />
            {error ? <p className="error">{error}</p> : null}
        </div>
    );
}
