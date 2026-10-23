import type { IncomingMessage } from 'node:http';

import type { ModeInfo } from '@/components/Layout';

import { cfg, endedSessionsChecked } from './config';
import { currentSession, type Session } from './sessions';
import { type User, userById } from './users';

/** What every page needs: which orangecheck it talks to, and who is signed in. */
export async function pageContext(
    req: IncomingMessage,
): Promise<{ info: ModeInfo; session: Session | null; user: User | null }> {
    const s = await currentSession(req);
    const session = s === 'unavailable' ? null : s;
    const user = session ? userById(session.user_id) : null;
    return {
        info: { mode: cfg().mode, endedSessionsChecked: endedSessionsChecked() },
        session,
        user,
    };
}
