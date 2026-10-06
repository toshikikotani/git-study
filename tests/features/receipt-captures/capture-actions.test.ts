import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  createCapture: vi.fn(async () => 'cap-1'),
  discardCapture: vi.fn(async () => {}),
  getCapture: vi.fn(),
  resolveCapture: vi.fn(async () => {}),
  restoreCapture: vi.fn(async () => {}),
  saveCaptureDraft: vi.fn(async () => {}),
  setCaptureEditedImage: vi.fn(async () => {}),
  setCaptureImage: vi.fn(async () => {}),
  updateCaptureReadResult: vi.fn(async () => {}),
}));
vi.mock('@/features/receipt-captures/store', () => store);

const saveBatch = vi.hoisted(() => vi.fn());
vi.mock('../../../app/(app)/transactions/actions', () => ({ saveImportBatchAction: saveBatch }));

const recordCorrection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/features/genre/memory-store', () => ({ recordCorrection }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const upload = vi.hoisted(() => vi.fn(async () => ({ path: 'u/img.jpg', error: null })));
vi.mock('@/features/import/receipt-storage', () => ({ uploadReceiptImage: upload }));

const supabase = vi.hoisted(() => ({
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: { image_path: 'u/orig.jpg', edited_image_path: null },
          error: null,
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabase }));

import {
  createCaptureFromReadAction,
  createManualCaptureAction,
  discardCaptureAction,
  recordRescanAction,
  resolveCaptureAction,
  restoreCaptureAction,
} from '../../../app/(app)/transactions/receipt/capture-actions';
import { emptyManualValues } from '@/domain/receipt-capture';

const parsed = (over = {}) => ({
  occurredOn: '2026-09-28',
  description: 'ローソン',
  amountYen: -500,
  paymentMethod: 'unknown' as const,
  items: [],
  expenseSubtype: null,
  storeName: 'ローソン',
  fieldConfidence: { store: 0.9, date: 0.9, total: 0.9 },
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('入力待ちを作る(読み取り失敗時)', () => {
  it('何も読めなかったら、画像とAIの生の結果を残して入力待ち(failed)にする', async () => {
    store.createCapture.mockResolvedValueOnce('cap-9');
    const r = await createCaptureFromReadAction({
      imageBase64: 'IMG',
      transactions: [],
      warnings: ['読めません'],
    });
    expect(r).toMatchObject({ error: null, receiptStatus: 'failed', captureId: 'cap-9' });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(store.createCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        imagePath: 'u/img.jpg',
        receiptStatus: 'failed',
        unreadFields: ['amountYen', 'occurredOn', 'storeName'],
        ocrRaw: { warnings: ['読めません'], transactions: [] },
      }),
    );
  });

  it('一部だけ読めたら partial。読めた項目が記録される', async () => {
    const r = await createCaptureFromReadAction({
      imageBase64: 'IMG',
      transactions: [parsed({ fieldConfidence: { store: 0.9, date: 0.1, total: 0.9 } })],
      warnings: [],
    });
    expect(r).toMatchObject({ receiptStatus: 'partial' });
    expect(store.createCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        readFields: { amountYen: 500, storeName: 'ローソン' },
        unreadFields: ['occurredOn'],
      }),
    );
  });

  it('全部読めたときは入力待ちを作らない(通常の確認画面へ)', async () => {
    const r = await createCaptureFromReadAction({
      imageBase64: 'IMG',
      transactions: [parsed()],
      warnings: [],
    });
    expect(r).toMatchObject({ error: null, receiptStatus: 'parsed', captureId: null });
    expect(store.createCapture).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('手入力(読み取りを介さない)は manual で作る', async () => {
    const r = await createManualCaptureAction('IMG');
    expect(r).toMatchObject({ error: null, captureId: 'cap-1' });
    expect(store.createCapture).toHaveBeenCalledWith(
      expect.objectContaining({ receiptStatus: 'manual' }),
    );
  });
});

describe('入力して保存(受け入れ基準14)', () => {
  const values = {
    ...emptyManualValues('2026-09-29', 'acc'),
    amountYen: 1280,
    occurredOn: '2026-09-28',
    storeName: 'ファミリーマート',
    genreId: 'dining',
    memo: '夜食',
  };

  it('金額・日付・店名・ジャンルを入力して保存すると、支出の明細になり、入力待ちが片付く', async () => {
    store.getCapture.mockResolvedValue({ id: 'cap-1', status: 'needs_input' });
    saveBatch.mockResolvedValue({
      imported: 1,
      duplicates: 0,
      error: null,
      splitWarnings: [],
      insertedIds: ['tx-1'],
    });
    const r = await resolveCaptureAction({ id: 'cap-1', values });
    expect(r).toMatchObject({ error: null, transactionId: 'tx-1' });

    const [preview, meta] = saveBatch.mock.calls[0]!;
    expect(preview[0]).toMatchObject({
      amountYen: -1280,
      occurredOn: '2026-09-28',
      merchantName: 'ファミリーマート',
      genreId: 'dining',
      memo: '夜食',
      source: 'manual',
    });
    expect(meta).toMatchObject({ accountId: 'acc', receiptImagePath: 'u/orig.jpg' });
    expect(store.resolveCapture).toHaveBeenCalledWith('cap-1', 'tx-1');
  });

  it('店名とジャンルを、分類の履歴(学習)へ反映する', async () => {
    store.getCapture.mockResolvedValue({ id: 'cap-1', status: 'needs_input' });
    saveBatch.mockResolvedValue({
      imported: 1,
      duplicates: 0,
      error: null,
      splitWarnings: [],
      insertedIds: ['tx-1'],
    });
    await resolveCaptureAction({ id: 'cap-1', values });
    expect(recordCorrection).toHaveBeenCalledWith({
      storeName: 'ファミリーマート',
      itemName: 'ファミリーマート',
      genreId: 'dining',
    });
  });

  it('金額が無いと保存しない(検証)', async () => {
    const r = await resolveCaptureAction({
      id: 'cap-1',
      values: { ...values, amountYen: null },
    });
    expect(r.error).toBe('金額を入力してください');
    expect(saveBatch).not.toHaveBeenCalled();
  });

  it('保存済みのレシートは二重に保存しない', async () => {
    store.getCapture.mockResolvedValue({ id: 'cap-1', status: 'resolved' });
    const r = await resolveCaptureAction({ id: 'cap-1', values });
    expect(r.error).toBe('このレシートは保存済みです。');
    expect(saveBatch).not.toHaveBeenCalled();
  });

  it('保存に失敗したら入力待ちのまま残る(resolve しない)', async () => {
    store.getCapture.mockResolvedValue({ id: 'cap-1', status: 'needs_input' });
    saveBatch.mockResolvedValue({
      imported: 0,
      duplicates: 0,
      error: '取り込みに失敗しました。',
      splitWarnings: [],
      insertedIds: [],
    });
    const r = await resolveCaptureAction({ id: 'cap-1', values });
    expect(r.error).toBe('取り込みに失敗しました。');
    expect(store.resolveCapture).not.toHaveBeenCalled();
  });
});

describe('破棄と元に戻す(受け入れ基準12)', () => {
  it('破棄は行を消さず status を変えるだけ(画像・読み取り結果は残る)。元に戻せる', async () => {
    expect(await discardCaptureAction('cap-1')).toEqual({ error: null });
    expect(store.discardCapture).toHaveBeenCalledWith('cap-1');
    expect(await restoreCaptureAction('cap-1')).toEqual({ error: null });
    expect(store.restoreCapture).toHaveBeenCalledWith('cap-1');
  });
});

describe('再読み取りの記録(受け入れ基準16)', () => {
  it('結果を記録する。入力中の下書き(saveCaptureDraft)には触れない', async () => {
    const r = await recordRescanAction('cap-1', { transactions: [parsed()], warnings: [] });
    expect(r).toMatchObject({ error: null, receiptStatus: 'parsed' });
    expect(store.updateCaptureReadResult).toHaveBeenCalledTimes(1);
    expect(store.saveCaptureDraft).not.toHaveBeenCalled();
  });
});
