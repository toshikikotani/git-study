import { createElement as h, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/components/ui/bottom-sheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/bottom-sheet')>()),
  BottomSheet: ({ children }: { children: ReactNode }) => children,
}));

const { MoreMenu } = await import('@/components/ui/more-menu');

const standard = [
  '/payday',
  '/transactions/capture-text',
  '/transactions/import',
  '/transactions/paste',
  '/accounts',
  '/transactions/reconcile',
  '/transactions/duplicates',
  '/assistant',
  '/savings',
  '/investments',
  '/side-hustle',
  '/job-change',
  '/reports/more',
  '/reports/ai',
  '/reports/genres',
  '/welcome',
  '/settings/categories',
  '/settings/theme',
  '/settings/ai',
  '/settings/password',
];
const owner = ['/briefs', '/settings/gmail', '/settings/google', '/settings/rescued-emails'];

describe('全機能の索引', () => {
  it.each([false, true])('既存の%sオーナー権限の全リンクを保持する', (isOwner) => {
    const html = renderToString(h(MoreMenu, { account: { email: null, isOwner } }));
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(links.sort()).toEqual((isOwner ? [...standard, ...owner] : standard).slice().sort());
    expect(html).toContain('メニュー（すべての機能・設定）');
    expect(html).toContain('資産形成');
  });
});
