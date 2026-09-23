/**
 * LINE で受信したレシート画像の取り込み(受信 Webhook、本人発案)。
 *
 * ── なぜここに切り出すか ────────────────────────────────────
 * app/api/webhooks/line/route.ts(署名検証・events配列のパース)と、
 * 画像1枚ごとの「AI抽出→分類→保存」という業務ロジックを分ける
 * (features/import/mail-sync.ts が cron route から分離されているのと同じ理由)。
 *
 * ── 分類はルールのみ(AI分類は使わない)────────────────────
 * 本人のセッションが無い経路であり、次に本人が明細一覧を開くまで分類ミスに
 * 気づく手段が無い。app/api/cron/import-gmail/route.ts と同じ方針(ADR-019)
 * で、classifyUnclassified()(AI分類)は呼ばない。ルールに当たらなければ
 * 「未分類」のまま保存する(確認待ちキューは撤廃済み、本人発案・ADR-045)。
 *
 * ── 商品行の分割(transaction_splits)は対象外 ────────────────
 * /transactions/receipt の商品行分割(P-41)は本人がプレビュー画面で内容を
 * 確認してから保存する前提(assertValidSplits の失敗にその場で気づける)。
 * この経路には確認画面が無いため、レシート1枚=明細1件として保存し、商品行
 * (items)は抽出しても分割には使わない。分割したければ /transactions の
 * 編集画面から本人が後で行う。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClassificationRule } from '@/features/classification/rules';
import { buildPreview } from '@/features/transactions/import-pipeline';
import { importTransactionsAsAdmin } from '@/features/transactions/store';
import type { Database } from '@/lib/supabase/types';
import type { AiReceiptExtractor } from './receipt-ai';
import { uploadReceiptImage } from './receipt-storage';

export type LineReceiptImportResult = {
  imported: number;
  duplicates: number;
  /** LINE へ返信する要約文。読み取れなかった場合はその理由になる。 */
  summaryText: string;
};

/**
 * `admin`・`userId` は呼び出し側(route.ts)が用意する(本人のセッションが
 * 無い経路のため、features/transactions/store.ts の importTransactionsAsAdmin
 * と同じ管理クライアント + 明示的な user_id)。
 *
 * `uploadReceiptImage()` の型定義コメントは「本人のセッションの client を
 * 渡すこと」と書いているが、ここでの admin client 使用は安全(receipt-storage.ts
 * のヘッダー参照): パスは常に呼び出し側が渡す正しい userId から組み立てられ、
 * 他人の user_id を知らない限り他人のフォルダには書けない。
 */
export async function importLineReceiptAsAdmin(
  admin: SupabaseClient<Database>,
  userId: string,
  accountId: string,
  rules: readonly ClassificationRule[],
  extractor: AiReceiptExtractor,
  imageBase64: string,
  messageId: string,
): Promise<LineReceiptImportResult> {
  const extracted = await extractor.extract({ imageBase64, mediaType: 'image/jpeg' });

  if (extracted.transactions.length === 0) {
    return {
      imported: 0,
      duplicates: 0,
      summaryText: extracted.warnings[0] ?? 'レシートとして読み取れませんでした。',
    };
  }

  const { path: receiptImagePath } = await uploadReceiptImage(
    admin,
    userId,
    imageBase64,
    'image/jpeg',
  );

  const { data: categories, error: categoriesError } = await admin
    .from('categories')
    .select('id, name')
    .eq('user_id', userId);
  if (categoriesError) {
    throw new Error(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const preview = buildPreview(
    extracted.transactions,
    accountId,
    (index) => `line-${messageId}-${index}`,
    rules,
    categoryNameById,
    'manual',
  );

  const result = await importTransactionsAsAdmin(admin, userId, preview, {
    fileName: 'LINE',
    source: 'manual',
    accountId,
    failedCount: extracted.warnings.length,
    receiptImagePath,
  });

  return {
    imported: result.importedCount,
    duplicates: result.duplicateCount,
    summaryText: buildSummaryText(preview, result.duplicateCount, extracted.warnings),
  };
}

/** LINE への返信文。「取り込みました」だけでは読み取り内容が正しいか本人が確認できない。 */
function buildSummaryText(
  preview: ReturnType<typeof buildPreview>,
  duplicateCount: number,
  extractWarnings: readonly string[],
): string {
  const lines = preview.map((t) => {
    const amount = Math.abs(t.amountYen).toLocaleString('ja-JP');
    const category = t.categoryName ?? '未分類';
    return `${t.occurredOn} ${t.description} ${amount}円(${category})`;
  });

  if (duplicateCount > 0) {
    lines.push(`※ ${duplicateCount}件は取り込み済みのため重複として無視しました`);
  }
  for (const warning of extractWarnings) {
    lines.push(`⚠ ${warning}`);
  }

  return lines.join('\n');
}
