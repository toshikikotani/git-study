import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MerchantNameSnapshot } from '@/domain/merchant-name-review';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  listMerchantNameReviewGroups,
  saveMerchantNameChanges,
} from '@/features/transactions/merchant-name-store';
import { saveMerchantNameChangesAction } from '../../../app/(app)/spending/merchant-name-actions';

type Row = Record<string, unknown>;
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
let rows: Row[];
let user: { id: string } | null;
let authError: { message: string } | null;
let readError: { message: string } | null;
let writeFailures: Set<string>;
let throwingIds: Set<string>;
let fromCalls: number;
let patches: Row[];
let beforeUpdate: (() => void) | null;

function transaction(id = A, patch: Row = {}): Row {
  return {
    id,
    user_id: 'user-a',
    merchant_name: 'スキ薬局豊津店',
    description: 'レシートの原文',
    branch_name: null,
    updated_at: '2026-10-18T00:00:00Z',
    occurred_on: '2026-10-16',
    amount_yen: -3280,
    status: 'actual',
    is_transfer: false,
    review_status: 'confirmed',
    genre_id: 'daily',
    account_id: 'cash',
    ...patch,
  };
}

function snapshot(row: Row): MerchantNameSnapshot {
  return {
    id: row.id as string,
    merchantName: row.merchant_name as string | null,
    description: row.description as string,
    branchName: row.branch_name as string | null,
    updatedAt: row.updated_at as string,
  };
}

function change(row: Row, name = 'スギ薬局', branchName: string | null = '豊津店') {
  return { snapshot: snapshot(row), name, branchName };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
  rows = [transaction()];
  user = { id: 'user-a' };
  authError = null;
  readError = null;
  writeFailures = new Set();
  throwingIds = new Set();
  fromCalls = 0;
  patches = [];
  beforeUpdate = null;
  mocks.revalidatePath.mockReset();
  mocks.createClient.mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from: () => {
      fromCalls += 1;
      const predicates: ((row: Row) => boolean)[] = [];
      const sorts: { column: string; ascending: boolean }[] = [];
      let start = 0;
      let end = 999;
      let patch: Row | null = null;
      let single = false;
      let idFilter: string | null = null;
      const builder = {
        select: () => builder,
        update: (value: Row) => {
          patch = value;
          patches.push(value);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          if (column === 'id') idFilter = value as string;
          predicates.push((row) => row[column] === value);
          return builder;
        },
        is: (column: string, value: null) => {
          predicates.push((row) => row[column] === value);
          return builder;
        },
        neq: (column: string, value: unknown) => {
          predicates.push((row) => row[column] !== value);
          return builder;
        },
        lte: (column: string, value: string) => {
          predicates.push((row) => String(row[column]) <= value);
          return builder;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          sorts.push({ column, ascending: options?.ascending !== false });
          return builder;
        },
        range: (from: number, to: number) => {
          start = from;
          end = to;
          return builder;
        },
        maybeSingle: () => {
          single = true;
          return builder;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
          if (patch) beforeUpdate?.();
          if (patch && idFilter && throwingIds.has(idFilter))
            return Promise.reject(new Error('offline')).then(resolve, reject);
          const error = patch
            ? idFilter && writeFailures.has(idFilter)
              ? { message: 'failed' }
              : null
            : readError;
          let matches = rows.filter((row) => predicates.every((predicate) => predicate(row)));
          for (const { column, ascending } of [...sorts].reverse())
            matches.sort((left, right) => {
              const a = String(left[column]);
              const b = String(right[column]);
              return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
            });
          matches = matches.slice(start, end + 1);
          if (patch && !error) matches.forEach((row) => Object.assign(row, patch));
          return Promise.resolve({
            data: error ? null : single ? (matches[0] ?? null) : matches,
            error,
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  }));
});

afterEach(() => vi.useRealTimers());

describe('店名確認の読み込み', () => {
  it('本人の実績だけを全期間から取得し、予定・振替・除外を候補にしない', async () => {
    rows.push(
      transaction(B, { user_id: 'user-b' }),
      transaction('planned', { status: 'actual', occurred_on: '2026-10-19' }),
      transaction('transfer', { is_transfer: true }),
      transaction('ignored', { review_status: 'ignored' }),
      transaction('old', { occurred_on: '2020-01-01' }),
      transaction('past-scheduled', { status: 'scheduled', occurred_on: '2026-10-15' }),
    );
    const groups = await listMerchantNameReviewGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual([A, 'past-scheduled', 'old']);
    expect(groups[0]?.entries[0]).toMatchObject({
      ...snapshot(rows[0]!),
      occurredOn: '2026-10-16',
      amountYen: -3280,
    });
  });

  it('PostgRESTの1000件を超える候補も取りこぼさない', async () => {
    rows = Array.from({ length: 1001 }, (_, index) => transaction(String(index).padStart(5, '0')));
    expect((await listMerchantNameReviewGroups())[0]?.entries).toHaveLength(1001);
    expect(fromCalls).toBe(2);
  });

  it('読み取り障害を空の確認一覧として扱わない', async () => {
    readError = { message: 'private database error' };
    await expect(listMerchantNameReviewGroups()).rejects.toThrow(
      '店名の確認候補を取得できませんでした。',
    );
  });
});

describe('本人が確認した店名の保存', () => {
  it('merchant_nameとbranch_nameだけを変え、金額・日付・原文・カテゴリ・口座を保つ', async () => {
    const original = structuredClone(rows[0]!);
    const result = await saveMerchantNameChanges({
      changes: [{ ...change(rows[0]!), amount_yen: 0, genre_id: 'other' }],
    });
    expect(result).toEqual({ updatedIds: [A], failed: [], error: null });
    expect(rows[0]).toEqual({ ...original, merchant_name: 'スギ薬局', branch_name: '豊津店' });
    expect(patches).toEqual([{ merchant_name: 'スギ薬局', branch_name: '豊津店' }]);
  });

  it('nullの店名・支店もis-nullのCASで安全に修正できる', async () => {
    rows[0] = transaction(A, { merchant_name: null, description: '' });
    expect((await saveMerchantNameChanges({ changes: [change(rows[0]!)] })).updatedIds).toEqual([
      A,
    ]);
  });

  it.each([
    ['merchant_name', '別の店'],
    ['description', '変更済みの原文'],
    ['branch_name', '別支店'],
    ['updated_at', '2026-10-18T01:00:00Z'],
    ['occurred_on', '2026-10-19'],
    ['review_status', 'ignored'],
    ['is_transfer', true],
  ])('確認中に%sが変わっても上書きしない', async (column, value) => {
    const submitted = change(rows[0]!);
    beforeUpdate = () => {
      rows[0]![column as string] = value;
    };
    const result = await saveMerchantNameChanges({ changes: [submitted] });
    expect(result.updatedIds).toEqual([]);
    expect(result.failed).toEqual([{ id: A, error: expect.stringContaining('変更されています') }]);
    expect(rows[0]![column as string]).toBe(value);
    expect(rows[0]?.merchant_name).not.toBe('スギ薬局');
  });

  it('他人のIDを送っても更新できない', async () => {
    rows[0]!.user_id = 'user-b';
    const result = await saveMerchantNameChanges({ changes: [change(rows[0]!)] });
    expect(result.failed.map((failure) => failure.id)).toEqual([A]);
    expect(rows[0]?.merchant_name).toBe('スキ薬局豊津店');
  });

  it('部分失敗は成功IDと失敗IDを分け、成功扱いで消さず再試行できる', async () => {
    rows.push(transaction(B));
    const changes = rows.map((row) => change(row));
    writeFailures.add(B);
    const result = await saveMerchantNameChanges({ changes });
    expect(result).toMatchObject({ updatedIds: [A], failed: [{ id: B }], error: null });
    expect(rows[1]?.merchant_name).toBe('スキ薬局豊津店');
    writeFailures.clear();
    expect((await saveMerchantNameChanges({ changes: [changes[1]] })).updatedIds).toEqual([B]);
  });

  it('通信例外が起きた行も結果に残し、後続の明細は保存できる', async () => {
    rows.push(transaction(B));
    throwingIds.add(A);
    const result = await saveMerchantNameChanges({ changes: rows.map((row) => change(row)) });
    expect(result).toMatchObject({ updatedIds: [B], failed: [{ id: A }], error: null });
  });

  it.each([
    { changes: [] },
    { changes: [{ snapshot: {}, name: '店名', branchName: null }] },
    { changes: [{ ...change(transaction()), name: '' }] },
    { changes: [{ ...change(transaction()), name: '店\n名' }] },
    { changes: [{ ...change(transaction()), name: 'a'.repeat(201) }] },
    { changes: [{ ...change(transaction()), branchName: '' }] },
    { changes: [change(transaction()), change(transaction())] },
    { changes: Array.from({ length: 101 }, () => change(transaction())) },
  ])('不正な入力を更新前に拒否する %#', async (input) => {
    await expect(saveMerchantNameChanges(input)).rejects.toThrow('対象の明細を確認');
    expect(fromCalls).toBe(0);
  });

  it('前後の空白を省いて保存する', async () => {
    await saveMerchantNameChanges({ changes: [change(rows[0]!, ' スギ薬局 ', ' 豊津店 ')] });
    expect(rows[0]).toMatchObject({ merchant_name: 'スギ薬局', branch_name: '豊津店' });
  });
});

describe('認証とServer Actionの結果', () => {
  it('読込・保存のたびに認証を確認し、ログアウト後はDBに触れない', async () => {
    await listMerchantNameReviewGroups();
    fromCalls = 0;
    user = null;
    await expect(listMerchantNameReviewGroups()).rejects.toThrow('ログイン状態');
    await expect(saveMerchantNameChanges({ changes: [change(rows[0]!)] })).rejects.toThrow(
      'ログイン状態',
    );
    expect(fromCalls).toBe(0);
  });

  it('認証エラーもユーザーなしと同じ扱いにする', async () => {
    authError = { message: 'expired' };
    expect(await saveMerchantNameChangesAction({ changes: [change(rows[0]!)] })).toEqual({
      updatedIds: [],
      failed: [],
      error: 'ログイン状態を確認できませんでした。',
    });
    expect(fromCalls).toBe(0);
  });

  it('部分成功でも更新した画面を再検証する', async () => {
    rows.push(transaction(B));
    writeFailures.add(B);
    const result = await saveMerchantNameChangesAction({ changes: rows.map((row) => change(row)) });
    expect(result.updatedIds).toEqual([A]);
    expect(result.failed.map((failure) => failure.id)).toEqual([B]);
    expect(mocks.revalidatePath.mock.calls.flat()).toContain('/spending/review');
  });

  it('全失敗なら更新済みの表示や再検証をしない', async () => {
    writeFailures.add(A);
    expect(
      (await saveMerchantNameChangesAction({ changes: [change(rows[0]!)] })).failed,
    ).toHaveLength(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
