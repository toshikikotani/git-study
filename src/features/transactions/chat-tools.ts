/**
 * 「明細」を扱うAIチャットツールの純粋な部分(本人発案「AIに変更を頼む」、
 * ADR-054)。DB にもネットワークにも触れない(features/classification/chat-tools.ts
 * と同じ構成)。
 *
 * `./store` ではなく `./types` から読む(T-7/P10-4 と同じ理由——この
 * ファイル自体はサーバー専用の route からしか使わないが、`StoredTransaction`
 * 型はクライアント側の import-pipeline.ts とも共有するため、型の置き場を
 * store.ts に増やさない)。
 */

import { ChatToolError } from '@/lib/chat-tools';
import type { StoredTransaction } from '@/features/transactions/types';

/**
 * 会話に添えた明細一覧(id付き)から、モデルが指定したidを解決する。
 * ジャンル名の resolveGenreByName() と同じ考え方——存在しないidを
 * 勝手に読み替えず、そのidが見つからない旨だけを伝えて拒む。
 */
export function resolveTransactionById(
  id: unknown,
  transactions: readonly StoredTransaction[],
): StoredTransaction {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ChatToolError('transaction_id が指定されていません。');
  }
  const found = transactions.find((t) => t.id === id);
  if (!found) {
    throw new ChatToolError(
      `id=${id} の明細が見つかりません。会話に添えた明細一覧のidから選んでください。`,
    );
  }
  return found;
}

/**
 * システムプロンプトに埋め込む、直近の明細一覧を整形する。
 * ジャンル一覧と違い件数が多くなりうるため、呼び出し側が
 * 件数を絞ってから渡す(`features/assistant/chat-tools.ts` 参照)。
 */
export function formatTransactionContextLines(transactions: readonly StoredTransaction[]): string {
  const lines = transactions
    .map((t) => {
      const genre = t.genreName ?? '未分類';
      const memo = t.memo ? ` メモ=${JSON.stringify(t.memo)}` : '';
      return `- id=${t.id} ${t.occurredOn} ${JSON.stringify(t.description)} ${t.amountYen}円 → ${genre}${memo}`;
    })
    .join('\n');
  return lines === '' ? '(まだ明細がありません)' : lines;
}
