# oc-onboarding-examples

The whole orangecheck onboarding funnel, as small sites you can fork and run. Each
one has its own login, puts an orangecheck account behind it with
[Connect](https://ochk.io/docs/connect), lets the person claim that account at
[ochk.app](https://ochk.app), and signs them in with orangecheck afterwards.

Every example starts **offline** with no keys: stand-ins in its own folder answer
for ochk.io, so you can click through the funnel with no account anywhere. Fill in
`.env` from a free project at [ochk.app/me/projects](https://ochk.app/me/projects)
and the same code runs against orangecheck.

## What's in here

| Path | Stack | What it is |
| --- | --- | --- |
| [`node-next/`](./node-next) | Next.js 16, Pages Router, SQLite | The whole funnel: sign-up, Connect (opt-in box or seamless), claiming, sign in with orangecheck, link and unlink, account deletion. |
| [`python-fastapi/`](./python-fastapi) | FastAPI, server-rendered, SQLite | The same funnel in Python, on the `orangecheck` package. Plain forms; the sign-in button is the SDK's, from jsDelivr with Subresource Integrity. |
| [`guardian/`](./guardian) | bash, the guardian kit, regtest | A local, throwaway Fedimint federation of four guardians, run with `oc-guardian`: the key ceremony, consensus and a deposit. Nothing leaves your machine. |

## The funnel, and where each step stands

Read on 2026-10-23. This table changes when a status does.

| Step | What the person does | Status |
| --- | --- | --- |
| 1 | Signs up with your site's own login | Yours. orangecheck is not involved. |
| 2 | Gets an orangecheck account through Connect, without asking or by ticking a box | Live. First run on 2026-10-23 by this repo's live check (`node-next/scripts/connect-smoke.mjs`): provision, a later tick, delete. `live.yml` runs it weekly against "oc-onboarding-examples live smoke", a test-mode project held by orangecheck's own setup account. |
| 3 | Claims that account at ochk.app | Deployed. The weekly run mints a live claim link; a person claiming one has not been run live yet. |
| 4 | Signs in with orangecheck | Live. |
| 5 | Moves to their own keys | **Not open.** See below. |

**Custody, in the words [ochk.app/custody](https://ochk.app/custody) uses.**
orangecheck holds every key that can move funds while the system is in testing.
"This is custody, not self-custody, and nothing moves out of it yet. Moving to your
own keys opens once an independent federation settles payouts. Signing in with
your own Bitcoin key is self-custody of your key today. It does not move what you
earn." These examples are identity only: no events, nothing paid.

## What you host, and what you still depend on

You host the site, its users, its sessions, the table of spent sign-in tokens,
and its webhook receiver. All of it is yours, under MIT, to run anywhere and to
take with you.

orangecheck runs the rest, and none of it can be self-hosted today:

| Service | What the funnel uses it for |
| --- | --- |
| ochk.io | Issues sign-in tokens, ends them, and answers the Connect API |
| me.ochk.io | The sign-in popup, your project's sign-in rule, and the list of ended sessions |
| ochk.app | Where a person claims their account, and where you make your project and keys |

What is open: the SDKs ([`@orangecheck/me-client`](https://www.npmjs.com/package/@orangecheck/me-client),
[`@orangecheck/auth-core`](https://www.npmjs.com/package/@orangecheck/auth-core),
[`orangecheck`](https://pypi.org/project/orangecheck/) on PyPI), checking a token
offline against the published keys, a [relay](https://github.com/orangecheck/oc-relay-infra),
and the [guardian kit](https://github.com/orangecheck/oc-guardian-kit).

So "host it yourself" means you own your integration and your users' mapping, and
can leave. It does not mean you can run orangecheck without orangecheck.

## Tests and CI

Each example has tests that call its real routes with a real database, offline.
They follow the checklist in [the quickstart](https://ochk.io/docs/me/quickstart):
a token starts one session once, a token without a revocation handle is refused, a
session ended everywhere is signed out here, and linking waits for a fresh sign-in
with the site's own login.

- `ci.yml` runs on every push and pull request, offline, with no secrets.
- `live.yml` runs weekly against a test project: Connect provision, claim link and
  delete. Its only secret is that project's Connect key, which cannot sign anyone
  in. Workflows from forks never see it.
- A day after an `@orangecheck/*` package publishes, Renovate opens one pull
  request with the bump, and CI merges it once every check passes, so the
  examples never teach an old API.

The repo is public, so its Actions minutes cost nothing.

## License

MIT. Fork freely. The orangecheck name and marks are covered by
[TRADEMARK.md](./TRADEMARK.md).

## Related

- **Docs**: [ochk.io/docs/connect](https://ochk.io/docs/connect), [ochk.io/docs/me/quickstart](https://ochk.io/docs/me/quickstart), [ochk.io/docs/me/sdk](https://ochk.io/docs/me/sdk)
- **Your project and keys**: [ochk.app/me/projects](https://ochk.app/me/projects)
- **Custody, live**: [ochk.app/custody](https://ochk.app/custody)
