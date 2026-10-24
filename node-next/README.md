# node-next

A small site with its own login (an email and a password, kept in SQLite), with
orangecheck behind it. Next.js 16, Pages Router, Node 22.13 or later.

## Install

```sh
npm install
```

## Run it offline

```sh
npm run dev
```

Open http://localhost:3000. With no keys in the environment, nothing here talks
to orangecheck. The sign-in popup, the Connect API and ochk.app's claim page are
answered by stand-ins under `src/lib/stand-in.ts` and `src/pages/stand-in/`, in
the same shapes the real ones use. Then:

1. **Sign up**, and tick "Also create my orangecheck account". This is Connect: the
   site asks ochk.io for an account behind its own login.
2. On **Your account**, choose **Claim it at ochk.app**. The stand-in claim page
   plays ochk.app's part.
3. **Link orangecheck**. The site asks for your password first, then opens the
   sign-in popup (the stand-in's, offline).
4. **Sign out**, then **Sign in with orangecheck**. You come back to the same
   account.
5. **Unlink orangecheck**, or **Delete my account**. Deleting removes the
   orangecheck account Connect made, unless the person claimed it, in which case it
   stays theirs.

Someone who only ever signs in with orangecheck gets a new account here on their
first sign-in, with no password and no Connect.

## Run it live

You need a project at [ochk.app/me/projects](https://ochk.app/me/projects). It is
free, in test mode or live.

1. Copy `.env.example` to `.env`.
2. Fill in `OC_PROJECT_KEY` and, for a deployment, `OC_SIGNING_SECRET`, from the
   project's Keys & webhooks tab. To verify the project's domain by meta tag,
   put its token in `OC_DOMAIN_VERIFY`; every page then serves
   `<meta name="oc-domain-verify">`.
3. For Connect, switch on "Your own login" in the project's Sign-in tab, and put
   the API key it shows you, once, in `OCHK_CONNECT_KEY`.
4. Set `SITE_ORIGIN` to this site's exact origin. Sign-in tokens are bound to it.
5. Point the project's webhook at `https://<your site>/api/webhooks/orangecheck`,
   so the site hears when someone claims their account.

On localhost, use a test project and declare a development origin on it: the
project's Sign-in page on ochk.app, under Local development. It must equal
`SITE_ORIGIN` exactly, port included (`http://localhost:3000` by default). Then
set `OC_SIGNING_SECRET` locally too, and "Sign out everywhere" on ochk.app ends
your local session as it would a live one, within about a minute
([how](https://ochk.io/docs/me/sdk#when-someone-ends-every-session)).

With the secret set and no development origin declared, the list of ended
sessions can't be read for a local origin, so sign-in itself answers
`503 revocations_unavailable`. Without the secret, a local run signs in but
doesn't refuse a session someone ended everywhere, and a banner says so. A
project has one development origin, and going live clears it.

## Where each step lives

| Step                                                   | Files                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Sign up and sign in with the site's own login          | `src/pages/api/signup.ts`, `src/pages/api/signin.ts`, `src/lib/passwords.ts`                                      |
| Connect: an account, with or without the box           | `src/pages/api/signup.ts`, `src/pages/api/connect/provision.ts`, `src/lib/connect.ts`                             |
| Claiming at ochk.app                                   | `src/pages/api/connect/claim-link.ts`, `src/pages/api/webhooks/orangecheck.ts`                                    |
| Sign in with orangecheck                               | `src/components/OrangecheckButton.tsx`, `src/pages/api/auth/orangecheck.ts`, `src/lib/orangecheck.ts`             |
| The site's own sessions, and sessions ended everywhere | `src/lib/sessions.ts`                                                                                             |
| Link and unlink, after a fresh sign-in                 | `src/pages/api/reauth.ts`, `src/pages/api/account/link.ts`, `src/pages/api/account/unlink.ts`, `src/lib/guard.ts` |
| Deleting an account                                    | `src/pages/api/account/delete.ts`                                                                                 |

How the sign-in works:

- The button is the SDK's `SignInWithOrangecheck` (`@orangecheck/me-client/react`)
  with this site's own button class. Its default `inherit` appearance adds the
  orangecheck mark, in the button's text colour, and nothing else: the site's CSS
  styles it. `@orangecheck/me-client/button.css` sizes the mark and the target.
  The rules for its words and the mark are at
  [ochk.io/docs/integration/sign-in-button](https://ochk.io/docs/integration/sign-in-button).
- The popup hands the page a token bound to this site's origin.
- The page sends it once, as a Bearer header.
- The server checks it with `withOcAuth`, which also applies the project's "who
  can sign in" rule and refuses a token without a revocation handle (`rh`). While
  ochk.io's keys can't be read, it answers 503, never "signed out".
- The server spends the token with `spendOnce`, so it starts one session only.
- It then starts the site's own session, which keeps the token's `rh`, `aud` and
  `iat`, and ends the token at ochk.io with `revokeToken`. A token ochk.io can't
  take just then waits in `unended_tokens`, and goes with the next sign-in.

From then on, every request on that session asks the list of ended sessions. If
the person ended the session everywhere, they are signed out here too. If the list
can't be read, reads go on and writes answer 503, never "signed out".

## Verify

```sh
npm test
```

The tests call the real routes with a real database in memory, offline. Each one
checks a rule from [the quickstart's checklist](https://ochk.io/docs/me/quickstart)
or [the Connect docs](https://ochk.io/docs/connect):

- a token starts one session, once;
- a token without `rh`, for another site, or from another site is refused;
- a token ochk.io couldn't end is sent again, and an expired one is not;
- an unticked box makes no call to Connect, and only a tick sends `consent`;
- linking and unlinking wait for a fresh sign-in with the password;
- an account that earned is not deleted, and its person gets a claim link;
- a deployment refuses to start without its keys.

`npm run type-check`, `npm run lint`, `npm run format:check` and `npm run build`
are the rest of CI.

## Deploying

`npm run build && npm start` refuses to start in production without `SITE_ORIGIN`
(https), `OC_PROJECT_KEY` and `OC_SIGNING_SECRET`. Offline mode never runs in
production.

The database is one SQLite file in `.data/`, so this runs as-is on one server with
a disk. On serverless hosting, or on more than one server, move the tables in
`src/lib/db.ts` to your own database. The table of spent tokens must be one table
that every server shares, or a token could start a session on each.
`unended_tokens` holds live tokens until they expire: keep it as private as the
sessions.

## License

MIT, like the rest of this repo.
