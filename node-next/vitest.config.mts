import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        // One database per test file, in memory.
        env: { DB_PATH: ':memory:' },
    },
});
