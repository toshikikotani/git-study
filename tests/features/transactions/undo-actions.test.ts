import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
const rows: Record<string, unknown[]> = {};

/** from(table).select/insert/update/delete(...).eq/in(...) を記録するだけの簡易モック。 */
function builder(table: string) {
  let op = 'select';
  const record = (extra: unknown[] = []) => calls.push({ table, op, args: extra });
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => {
          record();
          resolve({ data: rows[table] ?? [], error: null });
        };
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
      }
      return (...args: unknown[]) => {
        if (['select', 'insert', 'update', 'delete'].includes(String(prop))) {
          op = String(prop);
          if (op !== 'select') calls.push({ table, op, args });
          if (op === 'insert') return Promise.resolve({ data: null, error: null });
        }
        return proxy;
      };
    },
  });
  return proxy;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (t: string) => builder(t),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/transactions/store', () => ({
  importTransactions: vi.fn(),
  updateTransaction: vi.fn(async () => {}),
  updateTransactionMemo: vi.fn(async () => {}),
  TransactionStoreError: class extends Error {},
}));
vi.mock('@/features/transactions/splits-store', () => ({ replaceSplits: vi.fn() }));
vi.mock('@/features/receipts/items-store', () => ({ replaceReceiptItems: vi.fn() }));
vi.mock('@/features/receipts/expense-subtype-store', () => ({ setExpenseSubtype: vi.fn() }));
vi.mock('@/features/genre/memory-store', () => ({ recordCorrection: vi.fn() }));

import {
  deleteTransactionAction,
  resolveReconcileAction,
  restoreDeletedTransactionAction,
  restoreRowFieldsAction,
  setTransactionKindAction,
  updateTransactionAction,
  updateTransactionMemoAction,
} from '../../../app/(app)/transactions/actions';

const txRow = {
  id: 't1',
  user_id: 'u1',
  genre_id: 'g-old',
  classified_by: 'manual',
  review_status: 'confirmed',
  reviewed_at: null,
  amount_yen: -500,
  occurred_on: '2026-09-28',
  note: '昔のメモ',
  kind: 'normal',
  reconcile_diff_yen: 30,
};

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rows)) delete rows[k];
  rows.transactions = [txRow];
});

describe('変更の Undo(変更前の値を返し、そのまま書き戻せる)', () => {
  it('ジャンル・金額・日付の変更は、変更前の値を返す', async () => {
    const r = await updateTransactionAction('t1', 'g-new');
    expect(r.error).toBeNull();
    expect(r.previous).toEqual([
      expect.objectContaining({ id: 't1', genre_id: 'g-old', amount_yen: -500, note: '昔のメモ' }),
    ]);
  });

  it('メモ・特別費・差額の確認も、変更前の値を返す', async () => {
    expect((await updateTransactionMemoAction('t1', '新しい')).previous?.[0]?.note).toBe(
      '昔のメモ',
    );
    expect((await setTransactionKindAction('t1', 'special')).previous?.[0]?.kind).toBe('normal');
    expect((await resolveReconcileAction(['t1'])).previous?.[0]?.reconcile_diff_yen).toBe(30);
  });

  it('書き戻すと、変更前の列(ジャンル・分類者・金額・日付・メモ・種別・差額)で更新される', async () => {
    const { previous } = await updateTransactionAction('t1', 'g-new');
    calls.length = 0;
    const r = await restoreRowFieldsAction(previous!);
    expect(r.error).toBeNull();
    const update = calls.find((c) => c.table === 'transactions' && c.op === 'update')!;
    expect(update.args[0]).toMatchObject({
      genre_id: 'g-old',
      classified_by: 'manual',
      amount_yen: -500,
      occurred_on: '2026-09-28',
      note: '昔のメモ',
      kind: 'normal',
      reconcile_diff_yen: 30,
    });
  });
});

describe('削除の Undo(明細・分割・品目を同じ id で戻す)', () => {
  it('削除前に丸ごと控えを取って返す', async () => {
    rows.transaction_splits = [{ id: 's1', transaction_id: 't1', amount_yen: -500 }];
    rows.receipt_items = [{ id: 'i1', transaction_id: 't1', name: '牛乳' }];
    const r = await deleteTransactionAction('t1');
    expect(r.error).toBeNull();
    expect(r.snapshot?.row).toMatchObject({ id: 't1' });
    expect(r.snapshot?.splits).toHaveLength(1);
    expect(r.snapshot?.items).toHaveLength(1);
    expect(calls.some((c) => c.table === 'transactions' && c.op === 'delete')).toBe(true);
  });

  it('控えから、明細 → 分割・品目の順で作り直す(同じ id)', async () => {
    rows.transaction_splits = [{ id: 's1', transaction_id: 't1' }];
    rows.receipt_items = [{ id: 'i1', transaction_id: 't1' }];
    const { snapshot } = await deleteTransactionAction('t1');
    calls.length = 0;
    const r = await restoreDeletedTransactionAction(snapshot!);
    expect(r.error).toBeNull();
    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts.map((c) => c.table)).toEqual([
      'transactions',
      'transaction_splits',
      'receipt_items',
    ]);
    expect((inserts[0]!.args[0] as { id: string }).id).toBe('t1');
  });
});
