import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../app/(app)/welcome/actions', () => ({
  completeWelcomeAction: vi.fn(),
  skipWelcomeAction: vi.fn(),
}));

const { WelcomeFlow } = await import('../../app/(app)/welcome/welcome-flow');

describe('はじめての設定(ADR-084)', () => {
  it('最初は手取りと給料日を聞き、あとで設定する道も出す', () => {
    const html = renderToString(
      h(WelcomeFlow, {
        today: '2026-10-07',
        initialTakeHomeYen: 250000,
        initialPayday: 25,
        starters: [{ genreId: 'g1', name: '食料品', share: 0.12 }],
      }),
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('はじめての設定 1/3');
    expect(html).toContain('まずは手取りと給料日');
    expect(html).toContain('value="250000"');
    expect(html).toContain('設定はあとでする');
  });
});
