/**
 * 読み取りに失敗したレシート(入力待ち)のデータアクセス(F7)。
 *
 * 元の画像とAIの生の読み取り結果は、破棄しても消さない(status='discarded' にして残す。
 * 「元に戻す」で復活できる)。テーブルが本番未適用の間は、読み取りは空、書き込みは
 * 「この機能はまだ使えません」を返す(明細の取り込み自体は止めない、ADR-033)。
 */

import type { CaptureField, ReadFields, ReceiptStatus } from '@/domain/receipt-capture';
import { CAPTURE_FIELDS, parseDraft, type CaptureDraft } from '@/domain/receipt-capture';
import { createReceiptImageSignedUrl } from '@/features/import/receipt-storage';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';
import type { CaptureView } from './types';

export class ReceiptCaptureError extends AppError {}

const NOT_AVAILABLE = '入力待ちの機能はまだ使えません(マイグレーションが未適用です)。';

type Row = {
  id: string;
  status: string;
  receipt_status: string;
  image_path: string;
  edited_image_path: string | null;
  ocr_raw: Json | null;
  read_fields: Json;
  unread_fields: string[];
  draft: Json | null;
  captured_on: string;
};

const COLUMNS =
  'id, status, receipt_status, image_path, edited_image_path, ocr_raw, read_fields, unread_fields, draft, captured_on';

export function toReadFields(raw: Json): ReadFields {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, Json | undefined>;
  const out: ReadFields = {};
  if (typeof r.amountYen === 'number') out.amountYen = r.amountYen;
  if (typeof r.occurredOn === 'string') out.occurredOn = r.occurredOn;
  if (typeof r.storeName === 'string') out.storeName = r.storeName;
  if (typeof r.genreId === 'string') out.genreId = r.genreId;
  return out;
}

function toWarnings(raw: Json | null): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const w = (raw as Record<string, Json | undefined>).warnings;
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string') : [];
}

async function toView(row: Row, withImage: boolean): Promise<CaptureView> {
  let imageUrl: string | null = null;
  if (withImage) {
    const supabase = await createClient();
    imageUrl = await createReceiptImageSignedUrl(
      supabase,
      row.edited_image_path ?? row.image_path,
      3600,
    );
  }
  return {
    id: row.id,
    status: row.status as CaptureView['status'],
    receiptStatus: row.receipt_status as ReceiptStatus,
    imageUrl,
    hasEditedImage: row.edited_image_path !== null,
    readFields: toReadFields(row.read_fields),
    unreadFields: row.unread_fields.filter((f): f is CaptureField =>
      (CAPTURE_FIELDS as readonly string[]).includes(f),
    ),
    draft: parseDraft(row.draft),
    capturedOn: row.captured_on,
    ocrWarnings: toWarnings(row.ocr_raw),
  };
}

/** 入力待ちの一覧(新しい順)。明細・要確認・目標カードに出す。 */
export async function listOpenCaptures(): Promise<CaptureView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('receipt_captures')
    .select(COLUMNS)
    .eq('status', 'needs_input')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new ReceiptCaptureError(`入力待ちのレシートを取得できませんでした: ${error.message}`);
  }
  return Promise.all((data as Row[]).map((r) => toView(r, true)));
}

export async function getCapture(id: string): Promise<CaptureView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('receipt_captures')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new ReceiptCaptureError(`入力待ちのレシートを取得できませんでした: ${error.message}`);
  }
  return data === null ? null : toView(data as Row, true);
}

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ReceiptCaptureError('ログイン状態を確認できませんでした');
  return data.user.id;
}

export async function createCapture(input: {
  imagePath: string;
  receiptStatus: ReceiptStatus;
  readFields: ReadFields;
  unreadFields: readonly CaptureField[];
  ocrRaw: Json | null;
  capturedOn?: string;
}): Promise<string> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('receipt_captures')
    .insert({
      user_id: userId,
      status: 'needs_input',
      receipt_status: input.receiptStatus,
      image_path: input.imagePath,
      ocr_raw: input.ocrRaw,
      read_fields: input.readFields as Json,
      unread_fields: [...input.unreadFields],
      ...(input.capturedOn ? { captured_on: input.capturedOn } : {}),
    })
    .select('id')
    .single();
  if (error) {
    if (isMissingTableError(error)) throw new ReceiptCaptureError(NOT_AVAILABLE);
    throw new ReceiptCaptureError(`入力待ちを保存できませんでした: ${error.message}`);
  }
  return data.id;
}

async function patch(id: string, values: Record<string, unknown>): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('receipt_captures')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    if (isMissingTableError(error)) throw new ReceiptCaptureError(NOT_AVAILABLE);
    throw new ReceiptCaptureError(`入力待ちを更新できませんでした: ${error.message}`);
  }
}

/** 入力途中の内容(下書き)を保存する。離れても消えない。 */
export async function saveCaptureDraft(id: string, draft: CaptureDraft): Promise<void> {
  await patch(id, { draft: draft as unknown as Json, draft_updated_at: new Date().toISOString() });
}

/** 再読み取りの結果(読めた項目・生の結果)を記録する。入力中の下書きには触れない。 */
export async function updateCaptureReadResult(
  id: string,
  input: {
    receiptStatus: ReceiptStatus;
    readFields: ReadFields;
    unreadFields: readonly CaptureField[];
    ocrRaw: Json | null;
  },
): Promise<void> {
  await patch(id, {
    receipt_status: input.receiptStatus,
    read_fields: input.readFields as Json,
    unread_fields: [...input.unreadFields],
    ocr_raw: input.ocrRaw,
  });
}

/** 補正した画像(切り抜き・回転・明るさ)を別のパスとして持つ。元の画像は残す。 */
export async function setCaptureEditedImage(id: string, path: string): Promise<void> {
  await patch(id, { edited_image_path: path });
}

/** 撮り直した画像に差し替える(元の画像のパスは履歴として ocr_raw に残さず、ファイルは消さない)。 */
export async function setCaptureImage(id: string, path: string): Promise<void> {
  await patch(id, { image_path: path, edited_image_path: null });
}

export async function resolveCapture(id: string, transactionId: string): Promise<void> {
  await patch(id, {
    status: 'resolved',
    transaction_id: transactionId,
    resolved_at: new Date().toISOString(),
  });
}

/** 破棄(画像・読み取り結果は残す)。Undo で restoreCapture できる。 */
export async function discardCapture(id: string): Promise<void> {
  await patch(id, { status: 'discarded', discarded_at: new Date().toISOString() });
}

export async function restoreCapture(id: string): Promise<void> {
  await patch(id, {
    status: 'needs_input',
    discarded_at: null,
    transaction_id: null,
    resolved_at: null,
  });
}
