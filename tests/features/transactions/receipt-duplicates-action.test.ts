import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chain } from '../../helpers/supabase-mock';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/transactions/store', () => ({
  importTransactions: vi.fn(),
  updateTransaction: vi.fn(),
  updateTransactionMemo: vi.fn(),
  TransactionStoreError: class extends Error {},
}));
vi.mock('@/features/transactions/splits-store', () => ({ replaceSplits: vi.fn() }));
vi.mock('@/features/receipts/items-store', () => ({ replaceReceiptItems: vi.fn() }));
vi.mock('@/features/receipts/expense-subtype-store', () => ({ setExpenseSubtype: vi.fn() }));
vi.mock('@/features/genre/memory-store', () => ({ recordCorrection: vi.fn() }));

import { checkReceiptDuplicatesAction } from '../../../app/(app)/transactions/actions';

const probe = { key: 'receipt', storeName: 'お店', occurredOn: '2026-10-17', amountYen: -500 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
  mocks.from.mockReturnValue(chain({ data: [], error: null }));
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: mocks.from });
});

describe('保存前の重複確認結果', () => {
  it('重複がない正常結果では成功を明示する', async () => {
    expect(await checkReceiptDuplicatesAction([probe])).toEqual({ duplicates: {}, error: null });
  });

  it('候補がある場合は既存の明細と成功状態を返す', async () => {
    mocks.from.mockReturnValue(
      chain({
        data: [
          {
            id: 'existing',
            description: 'お店',
            merchant_name: null,
            occurred_on: probe.occurredOn,
            amount_yen: -500,
            review_status: 'auto_ok',
          },
        ],
        error: null,
      }),
    );
    expect(await checkReceiptDuplicatesAction([probe])).toEqual({
      duplicates: {
        receipt: [{ id: 'existing', occurredOn: probe.occurredOn, amountYen: -500 }],
      },
      error: null,
    });
  });

  it.each(['db', 'transport', 'expired', 'auth'])(
    '確認できない場合(%s)を成功した空結果と区別する',
    async (failure) => {
      if (failure === 'db')
        mocks.from.mockReturnValue(chain({ data: null, error: { message: 'permission denied' } }));
      if (failure === 'transport') mocks.createClient.mockRejectedValue(new Error('offline'));
      if (failure === 'expired')
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
      if (failure === 'auth')
        mocks.getUser.mockResolvedValue({
          data: { user: { id: 'user' } },
          error: { message: 'expired' },
        });
      const result = await checkReceiptDuplicatesAction([probe]);
      expect(result.duplicates).toEqual({});
      expect(result.error).toEqual(expect.any(String));
      expect(result.error).not.toBe('permission denied');
      if (failure === 'expired' || failure === 'auth') expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it('確認対象がなければ認証やDBにアクセスせず正常終了する', async () => {
    expect(await checkReceiptDuplicatesAction([])).toEqual({ duplicates: {}, error: null });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
