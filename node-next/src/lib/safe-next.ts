/**
 * A path on this site to send someone back to, or `/account`. Refuses anything a
 * browser would take to another site: `//evil.com`, `/\evil.com`, a scheme,
 * control characters, which browsers drop (`/\t/evil.com` becomes `//evil.com`),
 * and dot segments, which can collapse into `//` (`/..//evil.com`).
 */
export function safeNext(raw: unknown, fallback = '/account'): string {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback;
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
    const segments = raw.split(/[?#]/, 1)[0]!.split('/');
    if (segments.some((s) => /^(\.|%2e){1,2}$/i.test(s))) return fallback;
    try {
        const u = new URL(raw, 'https://site.invalid');
        if (u.origin !== 'https://site.invalid') return fallback;
        const path = `${u.pathname}${u.search}${u.hash}`;
        return path.startsWith('//') || path.startsWith('/\\') ? fallback : path;
    } catch {
        return fallback;
    }
}
