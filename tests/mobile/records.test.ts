import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase, type FakeTables } from '../helpers/fake-supabase';

const s = vi.hoisted(() => ({ client: null as unknown, imported: [] as unknown[] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => s.client }));
vi.mock('@/features/accounts/store', () => ({
  getOrCreateDefaultAccount: async () => ({ id: 'cash' }),
}));
vi.mock('@/features/transactions/store', () => ({
  TransactionStoreError: class extends Error {},
  importTransactions: async (rows: { sourceRef: string }[]) => {
    s.imported.push(...rows);
    return {
      importedCount: rows.length,
      duplicateCount: 0,
      insertedTransactions: rows.map((r, i) => ({ id: `new-${i}`, sourceRef: r.sourceRef })),
    };
  },
}));

import { checkSourceOf } from '@/domain/today-check';
import { recordExpense, recordInputError, undoMobileRecords } from '@/features/mobile/records';

/** iPhone アプリの記録する・取り消す(ADR-132)。Web の記録するシートと同じ形で保存する。 */

const today = '2026-10-21';
function tables(): FakeTables {
  return {
    genres: [
      { id: 'food', user_id: 'me', name: '食料品' },
      { id: 'theirs', user_id: 'someone', name: '他人のカテゴリ' },
    ],
    transactions: [
      { id: 'app', user_id: 'me', source_ref: 'iphone-entry-1' },
      { id: 'photo', user_id: 'me', source_ref: 'iphone-photo-2-0' },
      { id: 'merged', user_id: 'me', source_ref: 'iphone-photo-3-0' },
      { id: 'web', user_id: 'me', source_ref: null },
      { id: 'mail', user_id: 'me', source_ref: 'gmail-x' },
    ],
    payment_merges: [
      { user_id: 'me', merged_transaction_id: 'merged', kept_transaction_id: 'mail' },
    ],
  };
}

beforeEach(() => {
  s.imported = [];
  s.client = fakeSupabase(tables(), { id: 'me' }).client;
});

describe('記録する', () => {
  it('金額・日付・名前を確かめる', () => {
    expect(recordInputError({ amountYen: 0, genreId: null }, today)).toMatch('金額');
    expect(recordInputError({ amountYen: 1.5, genreId: null }, today)).toMatch('金額');
    expect(recordInputError({ amountYen: 10_000_001, genreId: null }, today)).toMatch('金額');
    expect(
      recordInputError({ amountYen: 1200, genreId: null, occurredOn: '10/21' }, today),
    ).toMatch('日付');
    expect(
      recordInputError({ amountYen: 1200, genreId: null, label: 'あ'.repeat(61) }, today),
    ).toMatch('名前');
    expect(recordInputError({ amountYen: 1200, genreId: 'food' }, today)).toBeNull();
  });

  it('支出として1件入れる(名前が無ければカテゴリの名前、本人が選んだカテゴリ)。答え合わせには出さない', async () => {
    const result = await recordExpense('me', { amountYen: 1200, genreId: 'food' });
    expect(result.error).toBeNull();
    expect(result.record).toMatchObject({ amountYen: -1200, label: '食料品', genreName: '食料品' });
    expect(s.imported[0]).toMatchObject({
      accountId: 'cash',
      amountYen: -1200,
      genreId: 'food',
      classifiedBy: 'manual',
      source: 'manual',
    });
    const ref = (s.imported[0] as { sourceRef: string }).sourceRef;
    expect(ref).toMatch(/^iphone-entry-/);
    expect(checkSourceOf('manual', ref)).toBeNull();
    expect(checkSourceOf('manual', 'iphone-photo-1-0')).toBe('iphone_receipt');
  });

  it('他人のカテゴリは使えない', async () => {
    const result = await recordExpense('me', { amountYen: 1200, genreId: 'theirs' });
    expect(result.error).toMatch('カテゴリ');
    expect(s.imported).toEqual([]);
  });
});

describe('取り消す', () => {
  it('アプリから入れた記録だけ消す(Web やメールの記録は消さない)', async () => {
    const t = tables();
    s.client = fakeSupabase(t, { id: 'me' }).client;
    const result = await undoMobileRecords('me', ['app', 'photo', 'web', 'mail']);
    expect(result).toEqual({ removed: 2, error: null });
    expect(t.transactions!.map((r) => r.id).sort()).toEqual(['mail', 'merged', 'web']);
  });

  it('カードの通知メールと1件にまとめたレシートは消さない(答え合わせで分ける)', async () => {
    const t = tables();
    s.client = fakeSupabase(t, { id: 'me' }).client;
    const result = await undoMobileRecords('me', ['merged']);
    expect(result.removed).toBe(0);
    expect(result.error).toMatch('分ける');
    expect(t.transactions!.some((r) => r.id === 'merged')).toBe(true);
  });
});
