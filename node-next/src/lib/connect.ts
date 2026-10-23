import { connectClaimLink, connectDelete, connectProvision } from '@orangecheck/me-client/server';

import { cfg } from './config';
import { standInClaimLink, standInDelete, standInProvision } from './stand-in';

// OC Connect (ochk.io/docs/connect): an orangecheck account behind the site's
// own login, from the backend only. Live, these are the SDK's calls with the
// Connect API key; offline, the stand-ins answer in the same shapes.

export type ProvisionResult = Awaited<ReturnType<typeof connectProvision>>;
export type ClaimLinkResult = Awaited<ReturnType<typeof connectClaimLink>>;
export type DeleteResult = Awaited<ReturnType<typeof connectDelete>>;

export function connectConfigured(): boolean {
    const c = cfg();
    return c.mode === 'offline' || Boolean(c.connectKey);
}

/** `consent` only when the person ticked the box just now; an unticked box means no call at all. */
export async function provision(userId: string, consent: boolean): Promise<ProvisionResult> {
    const c = cfg();
    if (c.mode === 'offline') return standInProvision(userId, consent);
    return connectProvision({
        apiKey: c.connectKey!,
        userId,
        ...(consent ? { consent: true as const } : {}),
    });
}

export async function claimLink(userId: string): Promise<ClaimLinkResult> {
    const c = cfg();
    if (c.mode === 'offline') return standInClaimLink(userId);
    return connectClaimLink({ apiKey: c.connectKey!, userId });
}

export async function deleteConnect(userId: string): Promise<DeleteResult> {
    const c = cfg();
    if (c.mode === 'offline') return standInDelete(userId);
    return connectDelete({ apiKey: c.connectKey!, userId });
}
