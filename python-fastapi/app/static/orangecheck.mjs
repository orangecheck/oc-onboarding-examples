// The page's only script. Buttons marked data-orangecheck open orangecheck's sign-in
// popup (offline, the stand-in at /stand-in/popup) and send the token it hands back
// to their endpoint, once, as a Bearer header. The token is never kept in the page.
import { signInWithOcOutcome } from './popup.mjs';

const SENTENCES = {
    confirm_password_first: 'Confirm your password first.',
    did_taken: 'That orangecheck account is linked to another account here.',
    already_linked: 'This account already has orangecheck linked.',
    token_spent: 'That sign-in was used already. Try again.',
    no_handle: 'That sign-in can’t be ended, so it isn’t accepted. Try again.',
    no_session_handle: 'That sign-in can’t be ended, so it isn’t accepted. Try again.',
    revocations_unavailable: 'orangecheck can’t be reached just now. Try again in a minute.',
    key_set_unavailable: 'orangecheck can’t be reached just now. Try again in a minute.',
    bond_policy_unavailable: 'orangecheck can’t be reached just now. Try again in a minute.',
    bond_required: 'This site only takes orangecheck accounts backed by bitcoin.',
    signed_out: 'You’re signed out. Sign in again.',
};
const sentence = (code) => SENTENCES[code] || 'Something went wrong. Try again.';

for (const button of document.querySelectorAll('[data-orangecheck]')) {
    const error = button.parentElement.querySelector('.error');
    const label = button.textContent;
    const say = (text) => {
        error.textContent = text;
        error.hidden = !text;
    };
    button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Waiting for orangecheck…';
        say('');
        const offline = button.dataset.offline === 'true';
        const outcome = await signInWithOcOutcome(
            offline ? { popupOrigin: window.location.origin, popupPath: '/stand-in/popup' } : {},
        );
        if (outcome.status === 'blocked') {
            say('Your browser blocked the window. Allow pop-ups for this site, then try again.');
        }
        if (outcome.status === 'signed_in') {
            const r = await fetch(button.dataset.orangecheck, {
                method: 'POST',
                headers: { Authorization: `Bearer ${outcome.token}` },
            });
            const body = await r.json().catch(() => ({}));
            if (r.ok && body.ok) return window.location.assign(button.dataset.then);
            say(sentence(body.error));
        }
        button.disabled = false;
        button.textContent = label;
    });
}

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
