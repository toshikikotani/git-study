import { describe, expect, it, vi } from 'vitest';

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut } }),
}));
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
const deleted: string[] = [];
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [
      { name: 'sb-abc-auth-token.0' },
      { name: 'sb-abc-auth-token.1' },
      { name: 'color-theme' },
    ],
    delete: (name: string) => deleted.push(name),
  }),
}));

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

  it('サインアウトが失敗しても、セッションの cookie は消す(ログイン画面からホームへ戻されない)', async () => {
    deleted.length = 0;
    signOut.mockRejectedValueOnce(new Error('network'));
    await expect(signOutAction()).rejects.toThrow('REDIRECT:/login');
    expect(deleted).toEqual(['sb-abc-auth-token.0', 'sb-abc-auth-token.1']);
  });

  it('メニューの一番下に、押せる大きさ(44pt)のログアウトのボタンがある', async () => {
    const { readFileSync } = await import('node:fs');
    const menu = readFileSync('src/components/ui/more-menu.tsx', 'utf8');
    expect(menu).toContain('action={signOutAction}');
    expect(menu).toMatch(/min-h-11[^"]*"[\s\S]{0,200}ログアウト/);
  });
});
