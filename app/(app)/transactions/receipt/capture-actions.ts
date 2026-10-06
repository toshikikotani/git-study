'use server';

/**
 * 読み取りに失敗したレシート(入力待ち)の Server Action(F7)。
 *
 * 保存(resolveCaptureAction)は確認画面と同じ経路(buildReceiptSavePlan →
 * saveImportBatchAction)で明細にする。入力待ちは明細とは別の表なので、保存するまで
 * 集計・目標には一切入らない。破棄は行を消さず(画像・読み取り結果も残す)、Undo で戻せる。
 */

import { revalidatePath } from 'next/cache';

import {
  judgeReadResult,
  needsManualInput,
  toParsedReceipt,
  validateManualEntry,
  type CaptureDraft,
  type ManualEntryValues,
  type ReadFields,
  type ReceiptStatus,
  type CaptureField,
} from '@/domain/receipt-capture';
import { recordCorrection } from '@/features/genre/memory-store';
import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { uploadReceiptImage } from '@/features/import/receipt-storage';
import { buildReceiptSavePlan } from '@/features/import/receipt-save';
import {
  createCapture,
  discardCapture,
  getCapture,
  resolveCapture,
  restoreCapture,
  saveCaptureDraft,
  setCaptureEditedImage,
  setCaptureImage,
  updateCaptureReadResult,
} from '@/features/receipt-captures/store';
import type { CaptureView } from '@/features/receipt-captures/types';
import { todayJst } from '@/lib/date';
import { describeUserError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';
import { saveImportBatchAction } from '../actions';

type Result<T = object> = ({ error: null } & T) | { error: string };

const fail = (error: unknown, fallback: string): { error: string } => ({
  error: describeUserError(error, fallback),
});

async function uploadForUser(imageBase64: string): Promise<{ path: string } | { error: string }> {
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return { error: 'ログイン状態を確認できませんでした' };
  const uploaded = await uploadReceiptImage(supabase, auth.user.id, imageBase64, 'image/jpeg');
  if (uploaded.path === null) return { error: uploaded.error ?? '画像を保存できませんでした。' };
  return { path: uploaded.path };
}

/**
 * 読み取り結果が「一部だけ」「何も読めない」のとき、画像と生の結果を残して入力待ちにする。
 * 全部読めたときは何もしない(通常の確認画面へ)。
 */
export async function createCaptureFromReadAction(input: {
  imageBase64: string;
  transactions: readonly ParsedReceiptTransaction[];
  warnings: readonly string[];
}): Promise<Result<{ receiptStatus: ReceiptStatus; captureId: string | null }>> {
  const judged = judgeReadResult(input.transactions);
  if (!needsManualInput(judged.receiptStatus)) {
    return { error: null, receiptStatus: judged.receiptStatus, captureId: null };
  }
  try {
    const up = await uploadForUser(input.imageBase64);
    if ('error' in up) return up;
    const captureId = await createCapture({
      imagePath: up.path,
      receiptStatus: judged.receiptStatus,
      readFields: judged.readFields,
      unreadFields: judged.unreadFields,
      ocrRaw: {
        warnings: [...input.warnings],
        transactions: input.transactions,
      } as unknown as Json,
      capturedOn: todayJst(),
    });
    revalidatePath('/spending');
    return { error: null, receiptStatus: judged.receiptStatus, captureId };
  } catch (e) {
    return fail(e, '入力待ちを作れませんでした。');
  }
}

/** 画像だけで入力待ちを作る(読み取りを介さない手入力、H の「手入力」と同じ画面へ)。 */
export async function createManualCaptureAction(
  imageBase64: string,
): Promise<Result<{ captureId: string }>> {
  try {
    const up = await uploadForUser(imageBase64);
    if ('error' in up) return up;
    const captureId = await createCapture({
      imagePath: up.path,
      receiptStatus: 'manual',
      readFields: {},
      unreadFields: [],
      ocrRaw: null,
      capturedOn: todayJst(),
    });
    revalidatePath('/spending');
    return { error: null, captureId };
  } catch (e) {
    return fail(e, '入力待ちを作れませんでした。');
  }
}

export async function saveCaptureDraftAction(
  id: string,
  draft: CaptureDraft,
): Promise<{ error: string | null }> {
  try {
    await saveCaptureDraft(id, draft);
    return { error: null };
  } catch (e) {
    return fail(e, '下書きを保存できませんでした。');
  }
}

export async function discardCaptureAction(id: string): Promise<{ error: string | null }> {
  try {
    await discardCapture(id);
    revalidatePath('/spending');
    return { error: null };
  } catch (e) {
    return fail(e, '破棄できませんでした。');
  }
}

export async function restoreCaptureAction(id: string): Promise<{ error: string | null }> {
  try {
    await restoreCapture(id);
    revalidatePath('/spending');
    return { error: null };
  } catch (e) {
    return fail(e, '元に戻せませんでした。');
  }
}

/** 画像の差し替え(撮り直す/別の写真を選ぶ)。古い画像のファイルは消さない。 */
export async function replaceCaptureImageAction(
  id: string,
  imageBase64: string,
): Promise<{ error: string | null }> {
  try {
    const up = await uploadForUser(imageBase64);
    if ('error' in up) return up;
    await setCaptureImage(id, up.path);
    return { error: null };
  } catch (e) {
    return fail(e, '画像を差し替えられませんでした。');
  }
}

/** 補正した画像(切り抜き・回転・明るさ)を保存する。元の画像は残る。 */
export async function saveEditedCaptureImageAction(
  id: string,
  imageBase64: string,
): Promise<{ error: string | null }> {
  try {
    const up = await uploadForUser(imageBase64);
    if ('error' in up) return up;
    await setCaptureEditedImage(id, up.path);
    return { error: null };
  } catch (e) {
    return fail(e, '補正した画像を保存できませんでした。');
  }
}

/** もう一度読み取った結果を記録する(入力中の下書きには触れない)。 */
export async function recordRescanAction(
  id: string,
  input: {
    transactions: readonly ParsedReceiptTransaction[];
    warnings: readonly string[];
  },
): Promise<
  Result<{ receiptStatus: ReceiptStatus; readFields: ReadFields; unreadFields: CaptureField[] }>
> {
  try {
    const judged = judgeReadResult(input.transactions);
    await updateCaptureReadResult(id, {
      receiptStatus: judged.receiptStatus,
      readFields: judged.readFields,
      unreadFields: judged.unreadFields,
      ocrRaw: {
        warnings: [...input.warnings],
        transactions: input.transactions,
      } as unknown as Json,
    });
    return {
      error: null,
      receiptStatus: judged.receiptStatus,
      readFields: judged.readFields,
      unreadFields: judged.unreadFields,
    };
  } catch (e) {
    return fail(e, '読み取り結果を記録できませんでした。');
  }
}

/** 入力を明細として保存する(確認画面と同じ保存経路)。 */
export async function resolveCaptureAction(input: {
  id: string;
  values: ManualEntryValues;
  kind?: 'normal' | 'special';
}): Promise<Result<{ transactionId: string; insertedIds: string[] }>> {
  const errors = validateManualEntry(input.values, todayJst());
  const first = Object.values(errors)[0];
  if (first) return { error: first };

  try {
    const capture = await getCapture(input.id);
    if (capture === null) return { error: '入力待ちのレシートが見つかりません。' };
    if (capture.status === 'resolved') return { error: 'このレシートは保存済みです。' };
    const path = await captureImagePath(input.id);

    const parsed = toParsedReceipt(input.values);
    const plan = buildReceiptSavePlan({
      parsed,
      accountId: input.values.accountId,
      parentGenreId: input.values.genreId,
      genreByLineId: new Map(),
      kind: input.kind ?? 'normal',
      sourceRef: `capture-${input.id}`,
    });
    if (input.values.memo.trim() !== '') plan.transaction.memo = input.values.memo.trim();

    const outcome = await saveImportBatchAction(
      [plan.transaction],
      {
        fileName: 'レシート(手入力)',
        source: 'manual',
        accountId: input.values.accountId,
        failedCount: 0,
        receiptImagePath: path,
      },
      plan.splits ? [{ sourceRef: plan.transaction.sourceRef!, splits: plan.splits }] : [],
      plan.items.length > 0 ? [{ sourceRef: plan.transaction.sourceRef!, items: plan.items }] : [],
      [],
    );
    if (outcome.error) return { error: outcome.error };
    const transactionId = outcome.insertedIds[0];
    if (transactionId === undefined) {
      return {
        error: '同じ内容の明細が既にあるため追加しませんでした(下の「既存に添付」を使えます)。',
      };
    }
    await resolveCapture(input.id, transactionId);

    // 学習:この店のジャンルを履歴へ(次から自動で入る)。失敗しても保存は成功のまま。
    if (input.values.genreId !== null && input.values.storeName.trim() !== '') {
      try {
        await recordCorrection({
          storeName: input.values.storeName,
          itemName: input.values.storeName,
          genreId: input.values.genreId,
        });
      } catch {
        // 学習は補助
      }
    }
    revalidatePath('/spending');
    return { error: null, transactionId, insertedIds: outcome.insertedIds };
  } catch (e) {
    return fail(e, '保存できませんでした。');
  }
}

async function captureImagePath(id: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('receipt_captures')
    .select('image_path, edited_image_path')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data.edited_image_path ?? data.image_path;
}

/**
 * 既存の明細に、このレシートの画像を添付して入力待ちを片付ける(重複と分かったとき)。
 * 明細を増やさないので集計は変わらない。既に画像がある明細は、画像を差し替えない。
 */
export async function attachCaptureToTransactionAction(
  id: string,
  transactionId: string,
): Promise<{ error: string | null }> {
  try {
    const path = await captureImagePath(id);
    const supabase = await createClient();
    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .select('id, user_id, import_batch_id')
      .eq('id', transactionId)
      .single();
    if (txError) return { error: '既存の明細が見つかりません。' };

    let hasImage = false;
    if (tx.import_batch_id !== null) {
      const { data: batch } = await supabase
        .from('import_batches')
        .select('receipt_image_path')
        .eq('id', tx.import_batch_id)
        .maybeSingle();
      hasImage = !!batch?.receipt_image_path;
    }
    if (!hasImage) {
      const { data: created, error: batchError } = await supabase
        .from('import_batches')
        .insert({
          user_id: tx.user_id,
          source: 'manual',
          file_name: 'レシート添付',
          receipt_image_path: path,
          status: 'succeeded',
          completed_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (batchError) return { error: `画像を添付できませんでした: ${batchError.message}` };
      const { error: linkError } = await supabase
        .from('transactions')
        .update({ import_batch_id: created.id })
        .eq('id', transactionId);
      if (linkError) return { error: `画像を添付できませんでした: ${linkError.message}` };
    }
    await resolveCapture(id, transactionId);
    revalidatePath('/spending');
    return { error: null };
  } catch (e) {
    return fail(e, '添付できませんでした。');
  }
}

export async function loadCaptureAction(id: string): Promise<CaptureView | null> {
  try {
    return await getCapture(id);
  } catch {
    return null;
  }
}
