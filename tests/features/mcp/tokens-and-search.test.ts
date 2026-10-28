/**
 * MCP の鍵(ハッシュだけを残す)と、明細をさがす道具のしぼり方(ADR-142)。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/owner', () => ({ findOwner: vi.fn() }));

import { filterRecords, searchRange } from '@/features/mcp/data';
import {
  hashMcpToken,
  matchMcpToken,
  newMcpToken,
  storedTokensOf,
  toView,
  type StoredMcpToken,
} from '@/features/mcp/tokens';
import type { LedgerTransaction } from '@/features/spending/ledger-types';

describe('鍵', () => {
  const token = newMcpToken();
  const stored: StoredMcpToken = {
    id: 't1',
    name: 'Claude Code',
    hash: hashMcpToken(token),
    hint: `${token.slice(0, 8)}…`,
    createdAt: '2026-10-28T00:00:00Z',
  };

  it('kkb_ で始まる長い乱数。毎回ちがう', () => {
    expect(token).toMatch(/^kkb_[A-Za-z0-9_-]{43}$/);
    expect(newMcpToken()).not.toBe(token);
  });

  it('持っている鍵のハッシュと合えば通し、違えば通さない', () => {
    expect(matchMcpToken(token, [stored])).toBe(stored);
    expect(matchMcpToken(`${token}x`, [stored])).toBeNull();
    expect(matchMcpToken('kkb_wrong', [stored])).toBeNull();
    expect(matchMcpToken(token.replace('kkb_', 'xxx_'), [stored])).toBeNull();
    expect(matchMcpToken(token, [])).toBeNull();
  });

  it('鍵そのものは残さず、画面にもハッシュを出さない', () => {
    expect(stored.hash).not.toContain(token);
    expect(toView(stored)).not.toHaveProperty('hash');
  });

  it('app_metadata の形の読めない行は捨てる', () => {
    expect(storedTokensOf({ mcp_tokens: [stored, { id: 'x' }, null] })).toEqual([stored]);
    expect(storedTokensOf({})).toEqual([]);
    expect(storedTokensOf(null)).toEqual([]);
  });
});

describe('明細をさがす', () => {
  const tx = (over: Partial<LedgerTransaction>): LedgerTransaction =>
    ({
      id: 'x',
      occurredOn: '2026-10-20',
      label: 'ライフ',
      description: over.label ?? 'ライフ 渋谷店',
      memo: null,
      genreId: 'food',
      genreName: '食料品',
      amountYen: -1800,
      isTransfer: false,
      reviewStatus: 'auto_ok',
      kind: 'normal',
      needsInput: false,
      splits: [],
      ...over,
    }) as LedgerTransaction;
  const list = [
    tx({ id: 'a' }),
    tx({ id: 'b', occurredOn: '2026-10-25', label: '松屋', genreName: '外食', amountYen: -780 }),
    tx({ id: 'c', label: '給与', genreName: null, amountYen: 280000 }),
    tx({
      id: 'd',
      occurredOn: '2026-11-01',
      label: 'ドコモ',
      genreName: '通信費',
      amountYen: -7480,
    }),
    tx({ id: 'e', label: '口座振替', amountYen: -50000, isTransfer: true }),
    tx({ id: 'f', label: '返品', amountYen: 300, kind: 'refund' }),
  ];

  it('振替は出さず、新しい順。金額は正の円で種類を分け、予定は合計に入れない', () => {
    const r = filterRecords(list, {}, '2026-10-28');
    expect(r.rows.map((x) => x.store)).toEqual(['ドコモ', '松屋', 'ライフ', '給与', '返品']);
    expect(r.rows[0]).toMatchObject({ yen: 7480, type: 'expense', scheduled: true });
    expect(r.totals).toEqual({ expenseYen: 2580, incomeYen: 280000, refundYen: 300 });
  });

  it('言葉・カテゴリ・金額・種類でしぼる', () => {
    expect(filterRecords(list, { query: '渋谷' }, '2026-10-28').rows.map((x) => x.store)).toEqual([
      'ライフ',
    ]);
    expect(filterRecords(list, { category: '外' }, '2026-10-28').count).toBe(1);
    expect(filterRecords(list, { minYen: 1000, type: 'expense' }, '2026-10-28').count).toBe(2);
    expect(filterRecords(list, { limit: 2 }, '2026-10-28').rows).toHaveLength(2);
  });

  it('期間の既定は今月1日から今日まで。逆さま・長すぎる期間は断る', () => {
    expect(searchRange({}, '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(() => searchRange({ from: '2026-10-28', to: '2026-10-01' }, '2026-10-28')).toThrow();
    expect(() => searchRange({ from: '2024-01-01' }, '2026-10-28')).toThrow(/400日/);
  });
});
