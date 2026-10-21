import { describe, expect, it } from 'vitest';

import {
  autoMergeSamePayments,
  loadMergedNotes,
  splitMergedPayment,
} from '@/features/transactions/payment-merge';
import { fakeSupabase, type FakeTables } from '../../helpers/fake-supabase';

/** 同じ支払いを1件にまとめる・分ける(v4 の共通の土台1、ADR-129)。 */

function tables(): FakeTables {
  const base = {
    user_id: 'me',
    occurred_on: '2026-10-21',
    amount_yen: -453,
    description: '',
    is_transfer: false,
  };
  return {
    transactions: [
      {
        ...base,
        id: 'mail',
        merchant_name: 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ',
        source: 'gmail',
        import_batch_id: 'mail-batch',
        genre_id: null,
        classified_by: 'unclassified',
        review_status: 'pending',
      },
      {
        ...base,
        id: 'receipt',
        merchant_name: 'セブン-イレブン 渋谷店',
        source: 'manual',
        import_batch_id: 'receipt-batch',
        genre_id: 'food',
        classified_by: 'manual',
        review_status: 'auto_ok',
      },
    ],
    receipt_items: [
      { id: 'i1', user_id: 'me', transaction_id: 'receipt', name: 'おにぎり', sort_order: 0 },
    ],
    transaction_splits: [],
    import_batches: [
      { id: 'receipt-batch', user_id: 'me', receipt_image_path: 'me/r.jpg' },
      { id: 'mail-batch', user_id: 'me', receipt_image_path: null },
    ],
    payment_merges: [],
  };
}

describe('自動で1件にまとめる', () => {
  it('支払いの方を残し、品目・画像・レシートのカテゴリを移して、レシートは数えない', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    expect(await autoMergeSamePayments(client as never, 'me', ['2026-10-21'])).toBe(1);
    const mail = t.transactions!.find((r) => r.id === 'mail')!;
    const receipt = t.transactions!.find((r) => r.id === 'receipt')!;
    expect(mail).toMatchObject({ import_batch_id: 'receipt-batch', genre_id: 'food' });
    expect(receipt.review_status).toBe('ignored');
    expect(t.receipt_items![0]!.transaction_id).toBe('mail');
    expect(t.payment_merges).toHaveLength(1);
    expect((await loadMergedNotes(client as never, 'me', ['mail'])).get('mail')).toBe(
      'カードの通知メールの453円と同じ支払いなので、1件にまとめました',
    );
    // 2回目はもうまとめない
    expect(await autoMergeSamePayments(client as never, 'me', ['2026-10-21'])).toBe(0);
  });

  it('「分ける」で、まとめる前に戻す', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    await autoMergeSamePayments(client as never, 'me', ['2026-10-21']);
    await splitMergedPayment(client as never, 'me', 'mail');
    expect(t.transactions!.find((r) => r.id === 'mail')).toMatchObject({
      import_batch_id: 'mail-batch',
      genre_id: null,
      classified_by: 'unclassified',
    });
    expect(t.transactions!.find((r) => r.id === 'receipt')!.review_status).toBe('auto_ok');
    expect(t.receipt_items![0]!.transaction_id).toBe('receipt');
    expect(t.payment_merges).toEqual([]);
  });

  it('品目も画像もない手入力は、レシートではないのでまとめない', async () => {
    const t = tables();
    t.receipt_items = [];
    t.import_batches = [];
    const { client } = fakeSupabase(t);
    expect(await autoMergeSamePayments(client as never, 'me', ['2026-10-21'])).toBe(0);
  });

  it('まとめの表が無い(マイグレーション未適用)ときは何もしない', async () => {
    const { client } = fakeSupabase(
      tables(),
      { id: 'me' },
      {
        payment_merges: { code: 'PGRST205', message: 'relation does not exist' },
      },
    );
    expect(await autoMergeSamePayments(client as never, 'me', ['2026-10-21'])).toBe(0);
  });
});
