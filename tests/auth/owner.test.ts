import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { assertEmail } from '../../src/domain/auth';
import { createRateLimiter } from '../../src/lib/rate-limit';
import { pickOwner } from '../../src/lib/supabase/owner';

const u = (id: string, email: string, created: string) => ({ id, email, created_at: created });

describe('M2 本人(オーナー)の決め方', () => {
  const users = [
    u('c', 'carol@example.com', '2026-09-30T00:00:00Z'),
    u('a', 'alice@example.com', '2026-01-01T00:00:00Z'),
    u('b', 'bob@example.com', '2026-05-01T00:00:00Z'),
  ];

  it('OWNER_EMAIL があれば、そのユーザー(大文字小文字は問わない)', () => {
    expect(pickOwner(users, 'bob@example.com')?.id).toBe('b');
  });

  it('無ければ、最初に作ったユーザー(一覧の順に依らない)', () => {
    expect(pickOwner(users, null)?.id).toBe('a');
  });

  it('OWNER_EMAIL が見つからないときも、最初のユーザーに落ちる(別の人にはならない)', () => {
    expect(pickOwner(users, 'nobody@example.com')?.id).toBe('a');
  });

  it('ユーザーがいなければ null', () => {
    expect(pickOwner([], null)).toBeNull();
  });
});

describe('メールの検証・回数制限', () => {
  it('assertEmail は、前後の空白を取り、小文字にそろえ、形式を確かめる', () => {
    expect(assertEmail('  A@B.co ')).toBe('a@b.co');
    expect(() => assertEmail('a@b')).toThrow();
    expect(() => assertEmail('a b@c.d')).toThrow();
    expect(() => assertEmail(`${'a'.repeat(250)}@b.co`)).toThrow();
  });

  it('レート制限:窓の中で max 回まで、窓が過ぎれば戻る。キーごとに別', () => {
    let t = 0;
    const l = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect([l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, false]);
    expect(l.take('b')).toBe(true);
    t = 1500;
    expect(l.take('a')).toBe(true);
  });
});
