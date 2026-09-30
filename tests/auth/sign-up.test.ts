import { beforeEach, describe, expect, it, vi } from 'vitest';

const admin = {
  users: [] as { id: string; email: string; created_at: string }[],
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  total: 0,
};
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: admin.users, total: admin.total }, error: null }),
        createUser: admin.createUser,
        updateUserById: admin.updateUserById,
      },
    },
  }),
}));
let ip = '1.1.1.1';
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': ip }),
}));

import { signUpAction } from '../../app/login/actions';

beforeEach(() => {
  admin.createUser.mockReset().mockResolvedValue({ error: null });
  admin.updateUserById.mockReset();
  admin.total = 1;
  delete process.env.REGISTRATION_OPEN;
  delete process.env.REGISTRATION_MAX_USERS;
  ip = `10.0.0.${Math.floor(Math.random() * 250)}.${Math.random()}`;
});

describe('M1 誰でも自分で登録できる新規登録', () => {
  it('メールとパスワードで、確認済みのアカウントを作る(メールの確認リンクは挟まない)', async () => {
    const r = await signUpAction('  New@Example.com ', 'password123', 'password123');
    expect(r).toEqual({ error: null });
    expect(admin.createUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'password123',
      email_confirm: true,
    });
  });

  it('すでにあるメールアドレスでも、パスワードを書き換えない(乗っ取りの入口を閉じた)', async () => {
    admin.createUser.mockResolvedValue({ error: { message: 'User already registered' } });
    const r = await signUpAction('owner@example.com', 'hacked-pass-1', 'hacked-pass-1');
    expect(r.error).toContain('登録できませんでした');
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it('あるメールでも無いメールでも、失敗の言葉は同じ(登録の有無を知らせない)', async () => {
    admin.createUser.mockResolvedValue({ error: { message: 'User already registered' } });
    const a = await signUpAction('a@example.com', 'password123', 'password123');
    admin.createUser.mockResolvedValue({ error: { message: 'something else' } });
    const b = await signUpAction('b@example.com', 'password123', 'password123');
    expect(a.error).toBe(b.error);
  });

  it('入力の検証:メールの形式・パスワードの長さ・確認の一致', async () => {
    expect((await signUpAction('not-an-email', 'password123', 'password123')).error).toContain(
      'メールアドレス',
    );
    expect((await signUpAction('a@example.com', 'short', 'short')).error).toContain('8文字');
    expect((await signUpAction('a@example.com', 'password123', 'password124')).error).toContain(
      '一致',
    );
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('REGISTRATION_OPEN=false で新規登録だけ止められる', async () => {
    process.env.REGISTRATION_OPEN = 'false';
    const r = await signUpAction('a@example.com', 'password123', 'password123');
    expect(r.error).toContain('受け付けていません');
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('ユーザー数の上限に達したら受け付けない', async () => {
    process.env.REGISTRATION_MAX_USERS = '3';
    admin.total = 3;
    const r = await signUpAction('a@example.com', 'password123', 'password123');
    expect(r.error).toContain('上限');
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('同じ IP から短時間に何度も試すと止まる(10分に5回まで)', async () => {
    ip = '9.9.9.9';
    for (let i = 0; i < 5; i += 1) {
      await signUpAction(`u${i}@example.com`, 'password123', 'password123');
    }
    const r = await signUpAction('u6@example.com', 'password123', 'password123');
    expect(r.error).toContain('何度も');
  });
});
