// Runs once when the server starts (not during a build): a deployment without
// its keys refuses to start, rather than run with sessions nothing can end.
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const { assertDeployable } = await import('./lib/config');
    assertDeployable();
}
