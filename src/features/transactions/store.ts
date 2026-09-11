/**
 * 明細の保存先。
 *
 * ── なぜ抽象を挟むか ────────────────────────────────────────
 * Supabase はまだ繋がっていない(TASKS.md の B-4)。しかし取り込み画面と
 * 一覧画面は、保存先が決まらなくても作れる。ここを差し替え可能にしておけば、
 * M0-3 で SupabaseTransactionStore を足すだけで画面はそのまま動く。
 *
 * 現在の実装はブラウザの sessionStorage。タブを閉じると消える。
 * 「保存できたように見えて実は消えている」ことが本人に伝わるよう、
 * 画面側は必ず一時保存である旨を表示すること。
 */

import type { PaymentMethod } from '@/features/import/adapters';
import type { DateOnly } from '@/lib/date';

/** transactions テーブルの1行(画面が必要とする部分)。 */
export type StoredTransaction = {
  id: string;
  occurredOn: DateOnly;
  description: string;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  paymentMethod: PaymentMethod;
  categoryId: string | null;
  categoryName: string | null;
  /** 誰が分類したか。DB の classified_by に対応。 */
  classifiedBy: 'unclassified' | 'rule' | 'ai' | 'manual';
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  /**
   * 重複排除キー。DB では md5 のトリガが生成する。
   * ここでは同じ入力から同じ文字列を作れれば足りるため、正規化した値をそのまま使う。
   */
  fingerprint: string;
  /** 取り込み単位。まとめて取り消すために持つ。 */
  batchId: string;
};

export type ImportBatchSummary = {
  batchId: string;
  fileName: string;
  importedAt: string;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
};

export type AddResult = {
  imported: StoredTransaction[];
  /** 既に同じ明細があったため取り込まなかった件数。 */
  duplicateCount: number;
};

/** 確認待ちキューでの1件修正(M2-5)。ここで直せるのは分類だけ。 */
export type TransactionCorrection = {
  categoryId: string | null;
  categoryName: string | null;
  classifiedBy: StoredTransaction['classifiedBy'];
  reviewStatus: StoredTransaction['reviewStatus'];
};

export interface TransactionStore {
  list(): Promise<StoredTransaction[]>;
  batches(): Promise<ImportBatchSummary[]>;
  /** fingerprint が既存と重なるものは取り込まない(ADR-007 の冪等性)。 */
  add(transactions: readonly StoredTransaction[], batch: ImportBatchSummary): Promise<AddResult>;
  /** 取り込み単位で取り消す。列の指定を間違えたときの逃げ道。 */
  removeBatch(batchId: string): Promise<void>;
  /** 確認待ちキューでの1件修正(M2-5)。存在しない id は黙って無視する。 */
  update(id: string, correction: TransactionCorrection): Promise<void>;
  clear(): Promise<void>;
}

/**
 * 重複排除キーを作る。
 *
 * DB のトリガ(docs/schema.sql の set_transaction_fingerprint)と同じ材料・
 * 同じ正規化を使う。ハッシュ化しないのは、セッション内で一致すれば足りるため。
 * 材料の並びを変えるときは DB 側も揃えること。
 */
export function fingerprintOf(input: {
  occurredOn: DateOnly;
  amountYen: number;
  description: string;
}): string {
  const normalizedDescription = input.description.replace(/[\s　]/g, '').toLowerCase();
  return `${input.occurredOn.replace(/-/g, '')}|${input.amountYen}|${normalizedDescription}`;
}

const STORAGE_KEY = 'shisan.transactions.v1';
const BATCH_KEY = 'shisan.batches.v1';

/**
 * sessionStorage 実装。M0-3 で Supabase 実装に置き換わる。
 *
 * sessionStorage が使えない環境(プライベートモード等)でも画面が
 * 落ちないよう、読み書きは全て try/catch で包む。
 */
export class SessionTransactionStore implements TransactionStore {
  async list(): Promise<StoredTransaction[]> {
    return read<StoredTransaction>(STORAGE_KEY).sort(
      (a, b) =>
        b.occurredOn.localeCompare(a.occurredOn) || a.description.localeCompare(b.description),
    );
  }

  async batches(): Promise<ImportBatchSummary[]> {
    return read<ImportBatchSummary>(BATCH_KEY).sort((a, b) =>
      b.importedAt.localeCompare(a.importedAt),
    );
  }

  async add(
    transactions: readonly StoredTransaction[],
    batch: ImportBatchSummary,
  ): Promise<AddResult> {
    const existing = read<StoredTransaction>(STORAGE_KEY);
    const seen = new Set(existing.map((t) => t.fingerprint));

    const imported: StoredTransaction[] = [];
    let duplicateCount = 0;

    for (const tx of transactions) {
      if (seen.has(tx.fingerprint)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(tx.fingerprint);
      imported.push(tx);
    }

    write(STORAGE_KEY, [...existing, ...imported]);
    write(BATCH_KEY, [
      ...read<ImportBatchSummary>(BATCH_KEY),
      { ...batch, importedCount: imported.length, duplicateCount },
    ]);

    return { imported, duplicateCount };
  }

  async removeBatch(batchId: string): Promise<void> {
    write(
      STORAGE_KEY,
      read<StoredTransaction>(STORAGE_KEY).filter((t) => t.batchId !== batchId),
    );
    write(
      BATCH_KEY,
      read<ImportBatchSummary>(BATCH_KEY).filter((b) => b.batchId !== batchId),
    );
  }

  async update(id: string, correction: TransactionCorrection): Promise<void> {
    write(
      STORAGE_KEY,
      read<StoredTransaction>(STORAGE_KEY).map((t) => (t.id === id ? { ...t, ...correction } : t)),
    );
  }

  async clear(): Promise<void> {
    write(STORAGE_KEY, []);
    write(BATCH_KEY, []);
  }
}

function read<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // 壊れた値が入っていても画面は動かす
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 容量超過やプライベートモード。取り込みは失敗するが画面は落とさない
  }
}

/** 画面が使う既定の保存先。M0-3 でここを差し替える。 */
export const transactionStore: TransactionStore = new SessionTransactionStore();
