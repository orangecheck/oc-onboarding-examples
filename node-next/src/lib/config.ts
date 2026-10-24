// What this site runs against: orangecheck itself (live), or the stand-ins in
// this folder (offline, so the funnel can be clicked through with no account).

export type Mode = 'offline' | 'live';
export type ConnectMode = 'opt-in' | 'seamless';

function read(name: string): string | undefined {
    const v = process.env[name]?.trim();
    return v ? v : undefined;
}

export interface Config {
    mode: Mode;
    /** This site's origin, exactly: the audience every sign-in token must name. */
    siteOrigin: string;
    projectKey?: string;
    signingSecret?: string;
    connectKey?: string;
    connectMode: ConnectMode;
    production: boolean;
}

/** Read on every call, so a test can change the environment between cases. */
export function cfg(): Config {
    const projectKey = read('OC_PROJECT_KEY');
    const connectKey = read('OCHK_CONNECT_KEY');
    return {
        mode: projectKey || connectKey ? 'live' : 'offline',
        siteOrigin: (read('SITE_ORIGIN') ?? `http://localhost:${read('PORT') ?? '3000'}`).replace(
            /\/$/,
            '',
        ),
        projectKey,
        signingSecret: read('OC_SIGNING_SECRET'),
        connectKey,
        connectMode: read('CONNECT_MODE') === 'seamless' ? 'seamless' : 'opt-in',
        production: process.env.NODE_ENV === 'production',
    };
}

/**
 * True on Vercel. Each function there keeps its own copy of the SQLite file in
 * /tmp, so a session one function writes, the next never reads: that copy proves
 * the domain and takes the webhook, and its forms are off.
 */
export function proofOnly(): boolean {
    return Boolean(read('VERCEL'));
}

/** True when sessions people ended everywhere are refused here (both keys set). */
export function endedSessionsChecked(c: Config = cfg()): boolean {
    return c.mode === 'live' && Boolean(c.projectKey && c.signingSecret);
}

/**
 * A deployment refuses to start without what makes it safe: its exact https
 * origin, and both keys, so a session someone ended everywhere is refused here
 * too. Offline mode never runs in production.
 */
export function assertDeployable(c: Config = cfg()): void {
    if (!c.production) return;
    const missing = (['SITE_ORIGIN', 'OC_PROJECT_KEY', 'OC_SIGNING_SECRET'] as const).filter(
        (n) => !read(n),
    );
    if (missing.length) {
        throw new Error(`Refusing to start in production without ${missing.join(', ')}.`);
    }
    if (!c.siteOrigin.startsWith('https://')) {
        throw new Error('Refusing to start in production: SITE_ORIGIN must be https.');
    }
}
