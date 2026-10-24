// The page's only script of its own. Each button[data-oc-sign-in] is orangecheck's
// button: live, button-auto.mjs (loaded by base.html from jsDelivr, pinned, with
// Subresource Integrity) draws the mark and opens orangecheck's sign-in popup;
// offline, the copy of the SDK's button.mjs next to this file does the same against
// the stand-in at /stand-in/popup. Either way the button reports through the same two
// events, and this file sends the token to the button's endpoint, once, as a Bearer
// header. The token is never kept in the page, and the server's check is the only
// answer: any script on a page can fire these events.

const SENTENCES = {
    confirm_password_first: 'Confirm your password first.',
    did_taken: 'That orangecheck account is linked to another account here.',
    already_linked: 'This account already has orangecheck linked.',
    token_spent: 'That sign-in was used already. Try again.',
    unauthenticated: 'That sign-in didn’t check out. Try again.',
    no_session_handle: 'That sign-in can’t be ended, so it isn’t accepted. Try again.',
    revocations_unavailable: 'orangecheck can’t be reached just now. Try again in a minute.',
    key_set_unavailable: 'orangecheck can’t be reached just now. Try again in a minute.',
    bond_policy_unavailable: 'orangecheck can’t be reached just now. Try again in a minute.',
    bond_required: 'This site only takes orangecheck accounts backed by bitcoin.',
    signed_out: 'You’re signed out. Sign in again.',
};
const sentence = (code) => SENTENCES[code] || 'Something went wrong. Try again.';

const say = (button, text) => {
    const error = button.parentElement.querySelector('.error');
    error.textContent = text;
    error.hidden = !text;
};

document.addEventListener('oc-sign-in-outcome', (event) => {
    const button = event.target.closest?.('button[data-orangecheck]');
    if (button) say(button, event.detail.message);
});

document.addEventListener('oc-signed-in', (event) => {
    const button = event.target.closest?.('button[data-orangecheck]');
    if (!button) return;
    event.detail.waitUntil(
        (async () => {
            const r = await fetch(button.dataset.orangecheck, {
                method: 'POST',
                headers: { Authorization: `Bearer ${event.detail.token}` },
            });
            const body = await r.json().catch(() => ({}));
            if (r.ok && body.ok) return window.location.assign(button.dataset.then);
            say(button, sentence(body.error ?? body.reason));
        })(),
    );
});

// Offline only: the stand-in popup answers its opener as the real one does, with
// { type: 'oc-signin-success', account, token }, posted to the opener's origin only.
const popupForm = document.getElementById('stand-in-popup');
popupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await fetch('/stand-in/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: new FormData(popupForm).get('name') }),
    });
    const body = await r.json().catch(() => ({}));
    if (body.ok && window.opener) {
        window.opener.postMessage(
            { type: 'oc-signin-success', account: body.account, token: body.token },
            popupForm.dataset.opener,
        );
    }
});

// Offline only: a claim link carries its token after #, which never reaches a server.
const claimForm = document.getElementById('stand-in-claim');
if (claimForm) claimForm.elements.t.value = new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';

// Last, so the forms above are answered while it loads.
if (document.body.dataset.mode === 'offline') {
    const { enhanceSignInButton, OUTCOME_COPY } = await import('./button.mjs');
    for (const button of document.querySelectorAll('button[data-oc-sign-in]')) {
        const tell = (type, detail) =>
            button.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
        enhanceSignInButton(button, {
            popup: { popupOrigin: window.location.origin, popupPath: '/stand-in/popup' },
            onOutcome: ({ status }) =>
                tell('oc-sign-in-outcome', { status, message: OUTCOME_COPY[status] ?? '' }),
            onSignedIn: async ({ account, token }) => {
                const work = [];
                tell('oc-signed-in', { account, token, waitUntil: (p) => work.push(p) });
                await Promise.all(work);
            },
        });
    }
}
