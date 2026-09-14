/**
 * レシート画像の保存(本人発案、ADR-021 の続き)。
 *
 * ── なぜ画像も残すのか ──────────────────────────────────────
 * receipt-ai.ts は書き写した結果(店名・金額・商品行)だけを返し、画像自体は
 * 取り込みが終わると同時に捨てていた。あとで「このレシート何だっけ」を
 * 確認したり、Gmail 側の通知と同じ買い物かどうかを見比べたりする手段が
 * 無かった(重複確認画面、features/transactions/duplicates-store.ts)。
 *
 * ── どこに置くか ────────────────────────────────────────────
 * receipts バケット(private)に "{user_id}/{uuid}.拡張子" で置く。
 * バケット自体は Storage REST API で作成済み(SQL の insert では触らない。
 * バケットの列構成はプラットフォームのバージョンで変わりうるため)。
 * アクセス制御は docs/schema.sql 7.1節のフォルダ単位 RLS ポリシー
 * (20260913000400_receipt_storage_rls.sql、B-8 として本人適用待ち)。
 *
 * ── 未適用の間の振る舞い ────────────────────────────────────
 * バケットは既に存在するため upload 自体は失敗しない。ポリシー未適用でも
 * パスに user_id を必ず含めるため、他人の user_id を知らない限り
 * 到達できない(推測されない前提)。失敗時は例外にせず null を返す
 * (splits-store.ts の isMissingTableError と同じ考え方。画像が保存でき
 * なくても明細の取り込み自体は止めない)。
 */

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ReceiptMediaType } from './receipt-ai';
import type { Database } from '@/lib/supabase/types';

export const RECEIPT_IMAGE_BUCKET = 'receipts';

const EXTENSION_BY_MEDIA_TYPE: Record<ReceiptMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type UploadReceiptImageResult = { path: string | null; error: string | null };

/**
 * レシート画像を本人のフォルダへ保存する。呼び出し側は本人のセッションで
 * 動く client(features/import receipt/upload の route handler)を渡すこと。
 * admin client を渡すと RLS を素通しして本人のフォルダ以外にも書けてしまう。
 */
export async function uploadReceiptImage(
  supabase: SupabaseClient<Database>,
  userId: string,
  imageBase64: string,
  mediaType: ReceiptMediaType,
): Promise<UploadReceiptImageResult> {
  const path = `${userId}/${randomUUID()}.${EXTENSION_BY_MEDIA_TYPE[mediaType]}`;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageBase64, 'base64');
  } catch {
    return { path: null, error: '画像を保存できませんでした。' };
  }

  const { error } = await supabase.storage.from(RECEIPT_IMAGE_BUCKET).upload(path, bytes, {
    contentType: mediaType,
    upsert: false,
  });
  if (error) {
    return { path: null, error: `画像を保存できませんでした: ${error.message}` };
  }
  return { path, error: null };
}

/**
 * 表示用の署名URL(既定5分だけ有効)。本人のセッションで呼ぶ前提
 * (RLS が「本人のフォルダのオブジェクトだけ」を保証する)。
 * バケット・パスが無ければ例外にせず null を返す(画面はリンクを出さないだけ)。
 */
export async function createReceiptImageSignedUrl(
  supabase: SupabaseClient<Database>,
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(RECEIPT_IMAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
