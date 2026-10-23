import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from 'jose';

import { cfg } from './config';
import { db, now } from './db';
import { markConnectClaimed } from './users';

// Offline mode only: stand-ins for what orangecheck runs, holding to the
// contracts its docs state, so the real SDK calls run against them.
//  - The sign-in popup and its key set, at /stand-in: signInWithOc opens it
//    through `popupOrigin` and `popupPath`, and verifyOcToken checks its
//    tokens through `issuer`.
//  - Connect's provision, claim link and delete (ochk.io/docs/connect).
// Nothing here talks to orangecheck. In live mode every /stand-in route is 404.

const KID = 'stand-in';

export function standInIssuer(): string {
    return `${cfg().siteOrigin}/stand-in`;
}

type Key = { privateKey: CryptoKey | Uint8Array; publicJwk: JWK };
const g = globalThis as { __standInKey?: Promise<Key>; __claimTokens?: Map<string, ClaimToken> };

/** One key per data directory, so a restart doesn't strand a popup mid-flow. */
function key(): Promise<Key> {
    g.__standInKey ??= (async () => {
        const dbPath = process.env.DB_PATH ?? '.data/site.db';
        const file = dbPath === ':memory:' ? null : join(dirname(dbPath), 'stand-in-key.json');
        if (file && existsSync(file)) {
            const jwk = JSON.parse(readFileSync(file, 'utf8')) as JWK;
            const { d: _d, ...publicJwk } = jwk;
            return { privateKey: await importJWK(jwk, 'EdDSA'), publicJwk };
        }
        const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
        const jwk = await exportJWK(pair.privateKey);
        if (file) {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 });
        }
        return { privateKey: pair.privateKey, publicJwk: await exportJWK(pair.publicKey) };
    })();
    return g.__standInKey;
}

export async function standInJwks() {
    return { keys: [{ ...(await key()).publicJwk, kid: KID, alg: 'EdDSA', use: 'sig' }] };
}

/** A test person's did: the same name gets the same did, so you can come back as them. */
export function standInDid(name: string): string {
    return `did:oc:${createHash('sha256').update(`stand-in ${name.trim().toLowerCase()}`).digest('hex').slice(0, 32)}`;
}

/** A sign-in token shaped as ochk.io issues one: bound to this site, with a revocation handle. */
export async function standInToken(name: string) {
    const did = standInDid(name);
    const token = await new SignJWT({
        did_oc: did,
        rh: randomBytes(16).toString('base64url'),
        name,
    })
        .setProtectedHeader({ alg: 'EdDSA', kid: KID })
        .setIssuer(standInIssuer())
        .setAudience(cfg().siteOrigin)
        .setSubject(`stand-in-${did.slice(-12)}`)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign((await key()).privateKey);
    return { token, account: { did_oc: did, display_name: name } };
}

// ---- Connect ----

interface Row {
    user_id: string;
    did_oc: string;
    consent: number;
    claimed: number;
    deleted: number;
}

interface ClaimToken {
    userId: string;
    exp: number;
}

const row = (userId: string) =>
    db().prepare('SELECT * FROM stand_in_connect WHERE user_id = ?').get(userId) as Row | undefined;

const freshDid = () => `did:oc:${randomBytes(16).toString('hex')}`;

export function standInProvision(userId: string, consent: boolean) {
    const r = row(userId);
    if (r?.deleted) {
        if (!consent)
            return { ok: false as const, reason: 'account_deleted' as const, status: 410 };
        const did = freshDid();
        db()
            .prepare(
                'UPDATE stand_in_connect SET did_oc = ?, consent = 1, claimed = 0, deleted = 0 WHERE user_id = ?',
            )
            .run(did, userId);
        return { ok: true as const, did_oc: did, is_new: true };
    }
    if (r) {
        if (consent)
            db().prepare('UPDATE stand_in_connect SET consent = 1 WHERE user_id = ?').run(userId);
        return { ok: true as const, did_oc: r.did_oc, is_new: false };
    }
    const did = freshDid();
    db()
        .prepare('INSERT INTO stand_in_connect (user_id, did_oc, consent) VALUES (?, ?, ?)')
        .run(userId, did, consent ? 1 : 0);
    return { ok: true as const, did_oc: did, is_new: true };
}

export function standInClaimLink(userId: string) {
    const r = row(userId);
    if (!r || r.deleted)
        return { ok: false as const, reason: 'unknown_user' as const, status: 404 };
    if (r.claimed) return { ok: false as const, reason: 'already_claimed' as const, status: 409 };
    const tokens = (g.__claimTokens ??= new Map());
    for (const [t, v] of tokens) if (v.userId === userId) tokens.delete(t); // a new link closes the last
    const t = randomBytes(24).toString('base64url');
    const exp = now() + 15 * 60;
    tokens.set(t, { userId, exp });
    return {
        ok: true as const,
        url: `${cfg().siteOrigin}/stand-in/claim#t=${t}`,
        expires_at: new Date(exp * 1000).toISOString(),
    };
}

/** What ochk.app does when the person confirms: the account is theirs, and the site hears connect.claimed. */
export function standInClaim(t: string): { ok: boolean } {
    const tokens = (g.__claimTokens ??= new Map());
    const hit = tokens.get(t);
    tokens.delete(t);
    if (!hit || hit.exp < now()) return { ok: false };
    const r = row(hit.userId);
    if (!r || r.deleted) return { ok: false };
    db().prepare('UPDATE stand_in_connect SET claimed = 1 WHERE user_id = ?').run(hit.userId);
    markConnectClaimed(r.did_oc);
    return { ok: true };
}

export function standInDelete(userId: string) {
    const r = row(userId);
    if (!r || r.deleted) return { ok: true as const, result: 'already_deleted' as const };
    db().prepare('UPDATE stand_in_connect SET deleted = 1 WHERE user_id = ?').run(userId);
    return { ok: true as const, result: r.claimed ? ('detached' as const) : ('deleted' as const) };
}
