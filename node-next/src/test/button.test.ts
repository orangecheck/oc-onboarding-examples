import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OrangecheckButton } from '@/components/OrangecheckButton';

// The words each page gives the button: signin.tsx and account.tsx.
const LABELS = ['Sign in with orangecheck', 'Link orangecheck'];

describe('the orangecheck button', () => {
    it.each(LABELS)('is this site’s button, with the mark before the words "%s"', (label) => {
        const html = renderToStaticMarkup(
            createElement(OrangecheckButton, {
                offline: false,
                endpoint: '/api/auth/orangecheck',
                label,
                then: '/account',
            }),
        );
        const button = /<button[^>]*>([\s\S]*?)<\/button>/.exec(html);
        expect(button, html).not.toBeNull();
        const [whole, inside] = button!;
        // The site's own class, and the SDK's inherit appearance: the site styles it.
        expect(whole).toMatch(/class="oc"/);
        expect(whole).toMatch(/data-oc-sign-in=""/);
        expect(whole).toMatch(/data-appearance="inherit"/);
        // The mark, drawn in the button's own colour, then the words.
        const mark =
            /^<svg[^>]*data-oc-mark="mono"[^>]*>(?:<polygon[^>]*fill="currentColor"[^>]*><\/polygon>){3}<\/svg>/.exec(
                inside,
            );
        expect(mark, inside).not.toBeNull();
        const words = /<span data-oc-label="">([^<]*)<\/span>$/.exec(inside.slice(mark![0].length));
        expect(words?.[1]).toBe(label);
        expect(words?.[1]).toMatch(/(^|[^\p{L}\p{N}])orangecheck($|[^\p{L}\p{N}])/u);
    });
});
