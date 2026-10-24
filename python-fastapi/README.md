# python-fastapi

The same site as [`node-next`](../node-next), in Python: its own login (an email and
a password, kept in SQLite), with orangecheck behind it. FastAPI, server-rendered
pages, Python 3.10 or later, [`orangecheck`](https://pypi.org/project/orangecheck/)
3.2 or later.

## Install

```sh
uv sync
```

## Run it offline

```sh
uv run python -m app
```

Open http://localhost:8000. With no keys in the environment, nothing here talks to
orangecheck. Stand-ins in `app/stand_in.py` answer for ochk.io's sign-in popup, the
Connect API and ochk.app's claim page. They answer with the SDK's own result
types, so the code paths are the ones that run live. Then:

1. **Sign up**, and tick "Also create my orangecheck account".
2. On **Your account**, choose **Claim it at ochk.app**, and confirm on the stand-in
   claim page.
3. **Confirm your password**, then **Link orangecheck** in the popup.
4. **Sign out**, then **Sign in with orangecheck**: the same account.
5. **Unlink orangecheck**, or **Delete my account**.

Pages are plain forms that post and redirect. "Sign in with orangecheck" is the
site's own `<button class="oc">`, marked `data-oc-sign-in`, with a
`<span data-oc-mark></span>` where the mark goes. `app/templates/base.html` loads the
me-client SDK's `button.css` and, live, its `button-auto.mjs` from jsDelivr: the tags
from [ochk.io/docs/integration/sign-in-button](https://ochk.io/docs/integration/sign-in-button),
pinned to one version with Subresource Integrity, and allowed by exact path in the
Content-Security-Policy (`app/main.py`). The SDK draws the mark in the button's text
colour and opens the sign-in popup; the site's CSS styles the rest.
`app/static/orangecheck.mjs` takes the token from the button's `oc-signed-in` event and
sends it to the server. Offline, it does the same with `app/static/button.mjs`, a copy of
the SDK's file pointed at the stand-in popup. When you upgrade, take the new tags from the
docs page and copy that version's `button.mjs`; a test fails while they differ.

## Run it live

Make a project at [ochk.app/me/projects](https://ochk.app/me/projects). It's free,
in test mode or live. Then copy `.env.example` to `.env` and fill it in, as the
[Node example's README](../node-next/README.md#run-it-live) describes. The variables
and the localhost steps, a development origin declared on your test project, are
the same.

## How the sign-in works

`app/orangecheck_signin.py` and `app/main.py`:

- The page sends the popup's token once, as a Bearer header.
- `check_oc_session` checks the signature, the issuer and this site's exact origin
  as audience, and refuses a token without `rh`. With your project key, it applies
  the project's "who can sign in" rule through `SignInPolicy`. A refusal comes back
  as the status and body to send: 503 while orangecheck can't be reached, 403 for
  an account that isn't backed enough, 500 for a project key that names no
  project, 401 for anything else.
- The site spends the token with `spend_once`, so it starts one session only. Then
  it starts its own session, keeping `session.rh`, this site's origin as `aud`, and
  `iat`. It ends the token at ochk.io with `revoke_token`. A token ochk.io can't
  take just then waits in `unended_tokens`, and goes with the next sign-in.
- On every later request, `RevocationList.status(rh, aud, iat)` says whether the
  person ended that session everywhere. If they did, they are signed out here. If the
  list can't be read, reads go on and writes are refused, never "signed out".

Offline, the stand-in's key set is passed as `jwks=`, so no key set is fetched.
Every route is a plain `def`, so FastAPI runs it in a thread: the SDK's calls are
synchronous and can wait on the network.

## Verify

```sh
uv run pytest
```

The tests call the real routes with a real in-memory database. Nothing reaches the
network: `httpx` is stubbed, and an unexpected request fails the test. They check
the same rules as the Node tests. The live path runs with the stand-in's keys and
everything else as live mode passes it: the project's rule, an outage of the list
of ended sessions, and a token ochk.io couldn't end.

`uv run ruff check` and `uv run ruff format --check` are the rest of CI.

## Deploying

Set `APP_ENV=production`, and the site refuses to start without `SITE_ORIGIN`
(https), `OC_PROJECT_KEY` and `OC_SIGNING_SECRET`. Offline mode never runs in
production.

Run it with `uvicorn app.main:app` behind your proxy. The database is one SQLite file
in `.data/`, so this runs as-is on one server with a disk. On more than one, move the
tables in `app/db.py` to your own database. The table of spent tokens must be one
table that every server shares. `unended_tokens` holds live tokens until they
expire: keep it as private as the sessions.

## License

MIT, like the rest of this repo. `app/static/button.mjs` is from
[`@orangecheck/me-client`](https://www.npmjs.com/package/@orangecheck/me-client),
also MIT.
