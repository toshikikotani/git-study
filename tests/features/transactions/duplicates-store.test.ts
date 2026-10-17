import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { duplicatePairSignature, type MatchableTransaction } from '@/domain/duplicate-match';
import { fakeSupabase, type FakeTables } from '../../helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), cookies: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/features/import/receipt-storage', () => ({ createReceiptImageSignedUrl: vi.fn() }));

import {
  listDuplicateCandidates,
  listDuplicateReview,
  saveDistinctPair,
  undoDistinctPair,
} from '@/features/transactions/duplicates-store';
import {
  decodeBrowserDuplicateDecisions,
  duplicateDecisionCookieName,
  duplicateDecisionDigest,
  writeBrowserDuplicateDecision,
} from '@/features/transactions/duplicate-decisions-cookie';

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const NOW = new Date('2026-10-17T12:00:00Z');
const missing = { code: 'PGRST205', message: 'Table is missing' };
let tables: FakeTables & {
  transactions: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
  duplicate_pair_decisions: Record<string, unknown>[];
};
let failures: Record<string, { code?: string; message: string }>;
let user: { id: string } | null;
let jar: Map<string, string>;

function transaction(id: string, source: string, userId = 'user-a') {
  return {
    id,
    user_id: userId,
    account_id: 'account',
    occurred_on: '2026-10-15',
    amount_yen: -1200,
    merchant_name: null,
    description: '買い物',
    source,
    is_transfer: false,
    review_status: 'auto_ok',
    genre_id: null,
    import_batch_id: null,
  };
}

function signature() {
  return duplicatePairSignature(
    ...(tables.transactions.slice(0, 2).map(
      (row) =>
        ({
          id: row.id,
          occurredOn: row.occurred_on,
          amountYen: row.amount_yen,
          source: row.source,
          isTransfer: row.is_transfer,
          reviewStatus: row.review_status,
          categoryId: row.genre_id,
        }) as MatchableTransaction,
    ) as [MatchableTransaction, MatchableTransaction]),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  user = { id: 'user-a' };
  failures = {};
  tables = {
    transactions: [transaction(A, 'manual'), transaction(B, 'gmail')],
    accounts: [{ id: 'account', name: '現金' }],
    duplicate_pair_decisions: [],
  };
  jar = new Map();
  mocks.cookies.mockImplementation(async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: { maxAge: number }) =>
      options.maxAge === 0 ? jar.delete(name) : jar.set(name, value),
  }));
  mocks.createClient.mockImplementation(async () => {
    const base = fakeSupabase(tables, user ?? { id: 'unused' }, failures).client;
    return {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: (table: string) => {
        const builder = base.from(table);
        if (table !== 'duplicate_pair_decisions') return builder;
        let deleting = false;
        const filters: [string, unknown][] = [];
        const proxy: unknown = new Proxy(builder, {
          get(target, key) {
            if (key === 'upsert')
              return async (row: Record<string, unknown>) => {
                if (failures[table]) return { error: failures[table] };
                tables[table] = (tables[table] ?? []).filter(
                  (item) =>
                    item.user_id !== row.user_id ||
                    item.transaction_a_id !== row.transaction_a_id ||
                    item.transaction_b_id !== row.transaction_b_id,
                );
                tables[table]!.push(row);
                return { error: null };
              };
            if (key === 'delete')
              return () => {
                deleting = true;
                return proxy;
              };
            if (key === 'eq')
              return (column: string, value: unknown) => {
                filters.push([column, value]);
                (target.eq as (column: string, value: unknown) => unknown)(column, value);
                return proxy;
              };
            if (key === 'then' && deleting)
              return (resolve: (result: unknown) => void) => {
                if (failures[table]) return resolve({ error: failures[table] });
                tables[table] = (tables[table] ?? []).filter(
                  (row) => !filters.every(([column, value]) => row[column] === value),
                );
                return resolve({ error: null });
              };
            if (key === 'then') return target.then;
            return (...args: unknown[]) => {
              (target[key as string] as (...args: unknown[]) => unknown)(...args);
              return proxy;
            };
          },
        });
        return proxy;
      },
    };
  });
});

afterEach(() => vi.useRealTimers());

describe('重複ペアの判断', () => {
  it('両明細を保持し、再読込後も判断を記憶して、取り消せる', async () => {
    const savedSignature = signature();
    await saveDistinctPair(B, A, savedSignature);
    expect(tables.duplicate_pair_decisions[0]).toMatchObject({
      user_id: 'user-a',
      transaction_a_id: A,
      transaction_b_id: B,
    });
    expect(tables.transactions.map((row) => row.review_status)).toEqual(['auto_ok', 'auto_ok']);
    expect(await listDuplicateCandidates(NOW)).toHaveLength(0);
    expect((await listDuplicateReview(NOW)).decided).toHaveLength(1);
    await undoDistinctPair(A, B, savedSignature);
    expect(await listDuplicateCandidates(NOW)).toHaveLength(1);
    expect(tables.duplicate_pair_decisions).toEqual([]);
  });

  it('DB未適用時も本人専用cookieに保存し、再訪・取り消しができる', async () => {
    failures.duplicate_pair_decisions = missing;
    const savedSignature = signature();
    await saveDistinctPair(A, B, savedSignature);
    expect(jar.get(duplicateDecisionCookieName('user-a'))).toContain(
      duplicateDecisionDigest(savedSignature),
    );
    const review = await listDuplicateReview(NOW);
    expect(review).toMatchObject({ candidates: [], storage: 'browser', hasBrowserDecisions: true });
    expect(review.decided).toHaveLength(1);
    expect(await listDuplicateCandidates(NOW)).toEqual([]);
    await undoDistinctPair(A, B, savedSignature);
    expect(jar.size).toBe(0);
    expect(await listDuplicateCandidates(NOW)).toHaveLength(1);
  });

  it('DB適用後もcookieの判断を引き継ぎ、重複した判断も一度で取り消す', async () => {
    failures.duplicate_pair_decisions = missing;
    const savedSignature = signature();
    await saveDistinctPair(A, B, savedSignature);
    delete failures.duplicate_pair_decisions;
    expect(await listDuplicateCandidates(NOW)).toEqual([]);
    await saveDistinctPair(A, B, savedSignature);
    expect((await listDuplicateReview(NOW)).decided).toHaveLength(1);
    await undoDistinctPair(B, A, savedSignature);
    expect(tables.duplicate_pair_decisions).toEqual([]);
    expect(jar.size).toBe(0);
    expect(await listDuplicateCandidates(NOW)).toHaveLength(1);
  });

  it('別ユーザーのIDを保存・解除できず、cookieをコピーしても本人の候補は隠れない', async () => {
    failures.duplicate_pair_decisions = missing;
    const oldSignature = signature();
    await saveDistinctPair(A, B, oldSignature);
    const cookie = jar.get(duplicateDecisionCookieName('user-a'))!;
    user = { id: 'user-b' };
    const C = 'cccccccc-0000-0000-0000-000000000003';
    const D = 'dddddddd-0000-0000-0000-000000000004';
    tables.transactions.push(transaction(C, 'manual', 'user-b'), transaction(D, 'gmail', 'user-b'));
    jar.set(duplicateDecisionCookieName('user-b'), cookie);
    await expect(saveDistinctPair(A, B, oldSignature)).rejects.toThrow('明細が変更');
    await expect(undoDistinctPair(A, B, oldSignature)).rejects.toThrow('明細が変更');
    expect(await listDuplicateCandidates(NOW)).toHaveLength(1);
    expect((await listDuplicateReview(NOW)).decided).toEqual([]);
  });

  it('画面を開いた後の日付変更を保存前に検出し、変更後に前の判断を流用しない', async () => {
    const oldSignature = signature();
    await saveDistinctPair(A, B, oldSignature);
    tables.transactions[0]!.occurred_on = '2026-10-14';
    await expect(saveDistinctPair(A, B, oldSignature)).rejects.toThrow('明細が変更');
    expect(await listDuplicateCandidates(NOW)).toHaveLength(1);
    expect((await listDuplicateReview(NOW)).decided).toEqual([]);
  });

  it('DBの権限障害を端末保存に切り替えて隠さない', async () => {
    failures.duplicate_pair_decisions = { code: '42501', message: 'Permission denied' };
    await expect(saveDistinctPair(A, B, signature())).rejects.toThrow('Permission denied');
    expect(jar.size).toBe(0);
  });

  it('未認証なら読み書きしない', async () => {
    user = null;
    await expect(listDuplicateReview(NOW)).rejects.toThrow('ログイン状態');
    await expect(saveDistinctPair(A, B, signature())).rejects.toThrow('ログイン状態');
  });
});

describe('端末保存の上限と期限', () => {
  it('90日で失効し、不正・過大なcookieを採用しない', () => {
    const now = Math.floor(NOW.getTime() / 1000);
    const hash = duplicateDecisionDigest('pair');
    expect(decodeBrowserDuplicateDecisions(`${hash}~${(now + 60).toString(36)}`, now)).toHaveLength(
      1,
    );
    expect(decodeBrowserDuplicateDecisions(`${hash}~${now.toString(36)}`, now)).toEqual([]);
    expect(
      decodeBrowserDuplicateDecisions(`${hash}~${(now + 91 * 86400).toString(36)}`, now),
    ).toEqual([]);
    expect(decodeBrowserDuplicateDecisions('invalid', now)).toEqual([]);
    expect(decodeBrowserDuplicateDecisions('x'.repeat(3501), now)).toEqual([]);
  });

  it('100件を4096byte未満で保持し、101件目でも古い判断を捨てない', async () => {
    for (let i = 0; i < 100; i += 1) await writeBrowserDuplicateDecision('user-a', `pair-${i}`);
    const cookie = jar.get(duplicateDecisionCookieName('user-a'))!;
    expect(Buffer.byteLength(encodeURIComponent(cookie))).toBeLessThan(4096);
    expect(decodeBrowserDuplicateDecisions(cookie)).toHaveLength(100);
    await expect(writeBrowserDuplicateDecision('user-a', 'pair-100')).rejects.toThrow('上限');
    expect(jar.get(duplicateDecisionCookieName('user-a'))).toBe(cookie);
  });
});
