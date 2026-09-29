/**
 * 撮影したレシートの読み取りキュー(撮影をブロックしない非同期処理)。
 *
 * 撮った直後にジョブを作り、読み取り(リサイズ → AI 抽出 → 分類)はバックグラウンドで
 * 進める。利用者はそのまま次のレシートを撮れる。明細には「読み取り中」の仮の行が
 * 出て、終わると「確認する」に変わる(PendingReceiptRows)。
 *
 * 状態は画面をまたいで保つモジュール変数(SPA の遷移では消えない)。ページを
 * 再読み込みすると読み取り前後のジョブは消える——画像を IndexedDB に残す永続化は
 * していない(DECISIONS.md のフォールバック。保存前に離脱しても、撮り直せば済む)。
 *
 * 状態遷移は純粋な reducer(queueReducer)に分け、テストできるようにしてある。
 */

import { useSyncExternalStore } from 'react';

import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { resizeToJpegBase64 } from '@/features/import/resize-image';

export type ReceiptJobStatus = 'reading' | 'ready' | 'error';

export type JobClassification = {
  key: string;
  genreId: string;
  confidence: number;
  source?: string;
};

export type ReceiptJob = {
  id: string;
  status: ReceiptJobStatus;
  previewUrl: string;
  imageBase64: string | null;
  createdAt: number;
  parsed: ParsedReceiptTransaction[];
  warnings: string[];
  classifications: JobClassification[];
  parentGenreIds: Record<number, string>;
  error: string | null;
};

export type QueueAction =
  | { type: 'add'; job: ReceiptJob }
  | {
      type: 'ready';
      id: string;
      imageBase64: string | null;
      parsed: ParsedReceiptTransaction[];
      warnings: string[];
      classifications: JobClassification[];
      parentGenreIds: Record<number, string>;
    }
  | { type: 'fail'; id: string; error: string }
  | { type: 'remove'; id: string };

export function queueReducer(state: readonly ReceiptJob[], action: QueueAction): ReceiptJob[] {
  switch (action.type) {
    case 'add':
      return [...state, action.job];
    case 'ready':
      return state.map((j) =>
        j.id === action.id
          ? {
              ...j,
              // 何も読み取れなかった(明細が空)ときはエラー扱いにして理由を見せる。
              status: action.parsed.length === 0 ? 'error' : 'ready',
              imageBase64: action.imageBase64,
              parsed: action.parsed,
              warnings: action.warnings,
              classifications: action.classifications,
              parentGenreIds: action.parentGenreIds,
              error:
                action.parsed.length === 0
                  ? (action.warnings[0] ?? '読み取れませんでした。')
                  : null,
            }
          : j,
      );
    case 'fail':
      return state.map((j) =>
        j.id === action.id ? { ...j, status: 'error', error: action.error } : j,
      );
    case 'remove':
      return state.filter((j) => j.id !== action.id);
  }
}

export function newJob(id: string, previewUrl: string, now: number): ReceiptJob {
  return {
    id,
    status: 'reading',
    previewUrl,
    imageBase64: null,
    createdAt: now,
    parsed: [],
    warnings: [],
    classifications: [],
    parentGenreIds: {},
    error: null,
  };
}

let state: ReceiptJob[] = [];
const listeners = new Set<() => void>();

function dispatch(action: QueueAction): void {
  state = queueReducer(state, action);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: ReceiptJob[] = [];

export function useReceiptJobs(): readonly ReceiptJob[] {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

export function removeReceiptJob(id: string): void {
  const job = state.find((j) => j.id === id);
  if (job) URL.revokeObjectURL(job.previewUrl);
  dispatch({ type: 'remove', id });
}

/** 読み取りの同時実行数(AI の呼び出しが詰まらないように)。 */
const CONCURRENCY = 2;
let running = 0;
const waiting: (() => Promise<void>)[] = [];

function pump(): void {
  while (running < CONCURRENCY && waiting.length > 0) {
    const task = waiting.shift()!;
    running += 1;
    void task().finally(() => {
      running -= 1;
      pump();
    });
  }
}

async function process(job: ReceiptJob, file: File): Promise<void> {
  try {
    const imageBase64 = await resizeToJpegBase64(file);
    const response = await fetch('/api/import/receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg' }),
    });
    if (!response.ok) {
      dispatch({ type: 'fail', id: job.id, error: '読み取りに失敗しました。' });
      return;
    }
    const result = (await response.json()) as {
      transactions: ParsedReceiptTransaction[];
      warnings: string[];
      classifications?: JobClassification[];
      parentGenreIds?: Record<number, string>;
    };
    dispatch({
      type: 'ready',
      id: job.id,
      imageBase64,
      parsed: result.transactions,
      warnings: result.warnings,
      classifications: result.classifications ?? [],
      parentGenreIds: result.parentGenreIds ?? {},
    });
  } catch (e) {
    dispatch({
      type: 'fail',
      id: job.id,
      error: e instanceof Error ? e.message : '読み取りに失敗しました。',
    });
  }
}

/** 撮った/選んだ画像をキューへ入れ、すぐ戻る(読み取りは裏で進む)。 */
export function enqueueReceiptFiles(files: readonly File[]): string[] {
  const ids: string[] = [];
  for (const file of files) {
    const job = newJob(crypto.randomUUID(), URL.createObjectURL(file), Date.now());
    ids.push(job.id);
    dispatch({ type: 'add', job });
    waiting.push(() => process(job, file));
  }
  pump();
  return ids;
}

/** 読み取り中のジョブ数(ナビのバッジ・明細の仮の行)。 */
export function countReading(jobs: readonly ReceiptJob[]): number {
  return jobs.filter((j) => j.status === 'reading').length;
}
