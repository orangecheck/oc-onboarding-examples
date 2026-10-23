// The page's side: post JSON to this site's own API and read the answer.

const SENTENCES: Record<string, string> = {
    bad_email: 'Enter an email address.',
    short_password: 'Use at least 10 characters.',
    email_taken: 'An account already uses that address. Sign in instead.',
    wrong_email_or_password: 'That email and password don’t match.',
    wrong_password: 'That password is wrong.',
    confirm_password_first: 'Confirm your password first.',
    did_taken: 'That orangecheck account is linked to another account here.',
    already_linked: 'This account already has orangecheck linked.',
    token_spent: 'That sign-in was used already. Try again.',
    no_handle: 'That sign-in can’t be ended, so it isn’t accepted. Try again.',
    revocations_unavailable: 'orangecheck can’t be reached just now. Try again in a minute.',
    connect_unavailable:
        'orangecheck can’t be reached just now, so nothing was deleted. Try again.',
    holds_earnings: 'Your orangecheck account holds earnings, so it stays. Claim it first.',
    bond_required: 'This site only takes orangecheck accounts backed by bitcoin.',
    signed_out: 'You’re signed out. Sign in again.',
};

export function sentence(code: string | undefined): string {
    return (code && SENTENCES[code]) || 'Something went wrong. Try again.';
}

export async function postJson(
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data ?? {}),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok && body.ok === true, status: r.status, body };
}
