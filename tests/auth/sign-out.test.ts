import { describe, expect, it, vi } from 'vitest';

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut } }),
}));
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

import { signOutAction } from '../../src/features/auth/actions';

describe('ログアウト', () => {
  it('セッションを消して、ログイン画面へ戻る', async () => {
    await expect(signOutAction()).rejects.toThrow('REDIRECT:/login');
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('サインアウトが失敗しても、ログイン画面へ戻す', async () => {
    signOut.mockRejectedValueOnce(new Error('network'));
    await expect(signOutAction()).rejects.toThrow('REDIRECT:/login');
  });

  it('メニューの一番下に、押せる大きさ(44pt)のログアウトのボタンがある', async () => {
    const { readFileSync } = await import('node:fs');
    const menu = readFileSync('src/components/ui/more-menu.tsx', 'utf8');
    expect(menu).toContain('action={signOutAction}');
    expect(menu).toMatch(/min-h-11[^"]*"[\s\S]{0,200}ログアウト/);
  });
});
