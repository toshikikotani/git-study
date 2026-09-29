/**
 * 明細リストのレシート縮小画像(署名付きURL)を引き当てる。
 * 取り込み単位(import_batches.receipt_image_path)→ Storage の署名URL(まとめて発行)。
 * 列・バケットが本番に無い間は、何も付けずに返す(画面は画像なしで描画する)。
 */

import { RECEIPT_IMAGE_BUCKET } from '@/features/import/receipt-storage';
import { isMissingColumnError, isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { LedgerTransaction } from './ledger-types';

const BATCH_CHUNK = 50;
const URL_TTL_SECONDS = 60 * 60;

export async function attachThumbnails(
  transactions: readonly LedgerTransaction[],
  batchIdByTransactionId: ReadonlyMap<string, string>,
): Promise<LedgerTransaction[]> {
  const batchIds = [...new Set(batchIdByTransactionId.values())];
  if (batchIds.length === 0) return [...transactions];

  try {
    const supabase = await createClient();
    const pathByBatch = new Map<string, string>();
    for (let i = 0; i < batchIds.length; i += BATCH_CHUNK) {
      const { data, error } = await supabase
        .from('import_batches')
        .select('id, receipt_image_path')
        .in('id', batchIds.slice(i, i + BATCH_CHUNK))
        .not('receipt_image_path', 'is', null);
      if (error) {
        if (isMissingColumnError(error) || isMissingTableError(error)) return [...transactions];
        return [...transactions];
      }
      for (const row of data)
        if (row.receipt_image_path) pathByBatch.set(row.id, row.receipt_image_path);
    }
    const paths = [...new Set(pathByBatch.values())];
    if (paths.length === 0) return [...transactions];

    const { data: signed, error } = await supabase.storage
      .from(RECEIPT_IMAGE_BUCKET)
      .createSignedUrls(paths, URL_TTL_SECONDS);
    if (error || !signed) return [...transactions];
    const urlByPath = new Map<string, string>();
    for (const s of signed) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);

    return transactions.map((t) => {
      const batchId = batchIdByTransactionId.get(t.id);
      const path = batchId ? pathByBatch.get(batchId) : undefined;
      const url = path ? urlByPath.get(path) : undefined;
      return url ? { ...t, thumbnailUrl: url } : t;
    });
  } catch {
    // サムネイルは飾り。失敗しても一覧は出す。
    return [...transactions];
  }
}
