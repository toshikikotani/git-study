/**
 * AI出力への👍👎フィードバック(N1本人要件「フィードバックは端末内に保存する」)。
 * サーバーへは送らない——本人以外が見ることのない端末内メモとして持つだけ。
 */

const STORAGE_KEY = 'ai-feedback';
const MAX_ENTRIES = 200;

export type AiFeedbackValue = 'up' | 'down';

export type AiFeedbackEntry = {
  /** どの機能のAI出力か(例: 'daily-report')。 */
  feature: string;
  /** 同じ出力への重複記録を避けるための識別子(例: 日付・レポートID)。 */
  contentKey: string;
  value: AiFeedbackValue;
  at: string;
};

export function saveAiFeedback(entry: AiFeedbackEntry): void {
  try {
    const list = loadAiFeedback();
    list.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    // プライベートモード等でlocalStorageが使えなくても致命的ではない。
  }
}

export function loadAiFeedback(): AiFeedbackEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AiFeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearAiFeedback(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上。
  }
}
