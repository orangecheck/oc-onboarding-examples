import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// The site's own login: a password, hashed with scrypt from node:crypto.

function derive(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) =>
        scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) =>
            err ? reject(err) : resolve(key),
        ),
    );
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`;
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
    const [scheme, salt, hash] = (stored ?? '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const want = Buffer.from(hash, 'base64url');
    const got = await derive(password, Buffer.from(salt, 'base64url'));
    return got.length === want.length && timingSafeEqual(got, want);
}
