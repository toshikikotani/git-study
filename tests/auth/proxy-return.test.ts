import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ signedIn: false, refresh: false }));
vi.mock('@/lib/env', () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-key',
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: {
            name: string;
            value: string;
            options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string };
          }[],
        ) => void;
      };
    },
  ) => ({
    auth: {
      getUser: async () => {
        if (state.refresh) {
          options.cookies.setAll([
            {
              name: 'sb-test-auth-token',
              value: state.signedIn ? 'refreshed' : '',
              options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
            },
          ]);
        }
        return { data: { user: state.signedIn ? { id: 'owner' } : null } };
      },
    },
  }),
}));

import { proxy } from '../../proxy';

beforeEach(() => {
  state.signedIn = false;
  state.refresh = false;
});

describe('カメラの入口をログイン後も残す', () => {
  it.each(['/camera', '/camera?source=shortcut', '/spending?capture=1'])(
    '%s を戻り先にする',
    async (path) => {
      const response = await proxy(new NextRequest(`https://app.example${path}`));
      const location = new URL(response.headers.get('location')!);
      expect(location.origin).toBe('https://app.example');
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('returnTo')).toBe(path);
    },
  );

  it('通常のログインには戻り先を追加しない', async () => {
    const response = await proxy(new NextRequest('https://app.example/'));
    expect(response.headers.get('location')).toBe('https://app.example/login');
  });

  it('ログイン済みならログイン画面からカメラへ送る', async () => {
    state.signedIn = true;
    const response = await proxy(
      new NextRequest('https://app.example/login?returnTo=%2Fcamera%3Fsource%3Dshortcut'),
    );
    expect(response.headers.get('location')).toBe('https://app.example/camera?source=shortcut');
  });

  it.each(['//example.com', '/login?returnTo=/camera', '/api/receipt'])(
    '不正な戻り先 %s はホームへ送る',
    async (target) => {
      state.signedIn = true;
      const response = await proxy(
        new NextRequest(`https://app.example/login?returnTo=${encodeURIComponent(target)}`),
      );
      expect(response.headers.get('location')).toBe('https://app.example/');
    },
  );

  it.each([true, false])(
    'リダイレクトでも更新した認証 cookie を残す: signedIn=%s',
    async (signedIn) => {
      state.signedIn = signedIn;
      state.refresh = true;
      const response = await proxy(
        new NextRequest(
          signedIn ? 'https://app.example/login?returnTo=%2Fcamera' : 'https://app.example/camera',
        ),
      );
      expect(response.cookies.get('sb-test-auth-token')).toMatchObject({
        value: signedIn ? 'refreshed' : '',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
    },
  );

  it('API はログインへ飛ばさず 401 のままにする', async () => {
    const response = await proxy(new NextRequest('https://app.example/api/receipt'));
    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
  });
});
