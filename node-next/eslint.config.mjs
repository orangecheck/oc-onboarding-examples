// The family's flat config (eslint-config-next 16 ships one; no FlatCompat).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
    ...nextCoreWebVitals,
    ...nextTypescript,
    { ignores: ['node_modules/**', '.next/**', '.vercel/**', '.data/**', 'next-env.d.ts'] },
    {
        // Scoped to next's plugin glob: a rule only resolves where its plugin is in scope.
        files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
        rules: {
            // Only > and } change what JSX parses; an apostrophe in prose renders as written.
            'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
];

export default eslintConfig;
