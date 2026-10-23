# python-fastapi

The same site as [`node-next`](../node-next), in Python: its own login (an email and
a password, kept in SQLite), with orangecheck behind it. FastAPI, server-rendered
pages, Python 3.10 or later, [`orangecheck`](https://pypi.org/project/orangecheck/)
3.

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

Pages are plain forms that post and redirect. The only script is
`app/static/orangecheck.mjs`, for the sign-in popup. Next to it is a copy of the
me-client SDK's `popup.mjs`, which has no imports; the quickstart's advice for a site
without a bundler is to serve it from your own origin. Copy it again when you
upgrade.

## Run it live

Make a project at [ochk.app/me/projects](https://ochk.app/me/projects). It's free,
in test mode or live. Then copy `.env.example` to `.env` and fill it in, as the
[Node example's README](../node-next/README.md#run-it-live) describes. The variables
and the localhost caveat are the same.

## How the sign-in works

`app/orangecheck_signin.py` and `app/main.py`:

- The page sends the popup's token once, as a Bearer header.
- `verify_session` checks the signature, the issuer and this site's exact origin as
  audience. In 3.0 it also refuses a token without `rh` (`require_handle`, on by
  default). With your project key, it applies the project's "who can sign in" rule
  through `SignInPolicy`.
- The site spends the token's `jti`, so the token starts one session only. Then it
  starts its own session, keeping `rh` (from `session.claims["rh"]`), this site's
  origin as `aud`, and `iat`. It ends the token at ochk.io.
- On every later request, `RevocationList.status(rh, aud, iat)` says whether the
  person ended that session everywhere. If they did, they are signed out here. If the
  list can't be read, reads go on and writes are refused, never "signed out".
- The SDK raises `InvalidSession` with a reason, and the HTTP answer is yours to
  choose: `refusal()` maps an outage to 503, an unbacked account to 403, and
  anything else to 401.

Some things the SDK does that its docs don't say yet:
- Offline, the stand-in's key set is passed as `jwks=`. `issuer=` alone changes the
  `iss` check, not where keys come from.
- Every route is a plain `def`, so FastAPI runs it in a thread. The SDK's calls are
  synchronous and can wait on the network.
- `connect.claimed` has no `id` in its body; the webhook's id travels in the
  `OC-Envelope-Id` header.

## Verify

```sh
uv run pytest
```

The tests call the real routes with a real in-memory database. Nothing reaches the
network: `httpx` is stubbed, and an unexpected request fails the test. They check
the same rules as the Node tests, plus the HTTP mapping of the SDK's refusals.

`uv run ruff check` and `uv run ruff format --check` are the rest of CI.

## Deploying

Set `APP_ENV=production`, and the site refuses to start without `SITE_ORIGIN`
(https), `OC_PROJECT_KEY` and `OC_SIGNING_SECRET`. Offline mode never runs in
production.

Run it with `uvicorn app.main:app` behind your proxy. The database is one SQLite file
in `.data/`, so this runs as-is on one server with a disk. On more than one, move the
tables in `app/db.py` to your own database. The table of spent tokens must be one
table that every server shares.

## License

MIT, like the rest of this repo. `app/static/popup.mjs` is from
[`@orangecheck/me-client`](https://www.npmjs.com/package/@orangecheck/me-client),
also MIT.
