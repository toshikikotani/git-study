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

import { judgeReadResult, needsManualInput, type ReceiptStatus } from '@/domain/receipt-capture';
import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import {
  deleteWaitingFile,
  loadWaitingFiles,
  saveWaitingFile,
} from '@/features/import/offline-store';

/**
 * reading    : 読み取り中
 * ready      : 読み取れた(確認して保存する)
 * waiting    : 読み取り待ち(圏外など。失敗ではない。オンラインに戻ると自動で読み取る)
 * needs_input: 読み取れなかった/一部だけ読めた。画像は入力待ちとして残してあり、手で入力する
 * error      : 入力待ちも作れなかった(画像を保存できないなど。撮り直してもらう)
 */
export type ReceiptJobStatus = 'reading' | 'ready' | 'waiting' | 'needs_input' | 'error';

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
  /** needs_input のとき、入力待ちの id(手入力の画面へ進む)。 */
  captureId: string | null;
  receiptStatus: ReceiptStatus | null;
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
  | { type: 'waiting'; id: string }
  | { type: 'retry'; id: string }
  | { type: 'captured'; id: string; captureId: string; receiptStatus: ReceiptStatus }
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
    case 'waiting':
      return state.map((j) => (j.id === action.id ? { ...j, status: 'waiting', error: null } : j));
    case 'retry':
      return state.map((j) => (j.id === action.id ? { ...j, status: 'reading', error: null } : j));
    case 'captured':
      return state.map((j) =>
        j.id === action.id
          ? {
              ...j,
              status: 'needs_input',
              captureId: action.captureId,
              receiptStatus: action.receiptStatus,
              error: null,
            }
          : j,
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
    captureId: null,
    receiptStatus: null,
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

/** いまのキューの中身(テスト・画面外からの参照用)。 */
export function getReceiptJobs(): readonly ReceiptJob[] {
  return state;
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

/**
 * 入力待ちを作る処理(Server Action)。features は app に依存しないので、画面側(layout)が
 * 起動時に渡す。未設定のときは入力待ちを作れず、従来どおり「読み取れませんでした」になる。
 */
export type CaptureCreator = (input: {
  imageBase64: string;
  transactions: readonly ParsedReceiptTransaction[];
  warnings: readonly string[];
}) => Promise<
  { error: null; receiptStatus: ReceiptStatus; captureId: string | null } | { error: string }
>;
let createCapture: CaptureCreator | null = null;
export function configureReceiptQueue(options: { createCapture: CaptureCreator }): void {
  createCapture = options.createCapture;
}

/** 読み取り待ち(オフライン)のジョブの元ファイル。オンラインに戻ったら再処理する。 */
const files = new Map<string, File>();

async function process(job: ReceiptJob, file: File): Promise<void> {
  files.set(job.id, file);
  try {
    const imageBase64 = await resizeToJpegBase64(file);

    // 圏外なら失敗にせず「読み取り待ち」にする(画像は端末に残し、戻ったら自動で読む)。
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await park(job.id, file);
      return;
    }

    let response: Response;
    try {
      response = await fetch('/api/import/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg' }),
      });
    } catch {
      // 通信できない(圏外・サーバーに届かない)。読み取りに失敗したのではなく、まだ読めていない。
      await park(job.id, file);
      return;
    }

    let result: {
      transactions: ParsedReceiptTransaction[];
      warnings: string[];
      classifications?: JobClassification[];
      parentGenreIds?: Record<number, string>;
    } = { transactions: [], warnings: ['読み取りに失敗しました。'] };
    if (response.ok) result = await response.json();

    // 全部読めていれば確認画面へ。読めなかった/一部だけなら、画像を残して入力待ちにする。
    if (!needsManualInput(judgeReadResult(result.transactions).receiptStatus)) {
      dispatch({
        type: 'ready',
        id: job.id,
        imageBase64,
        parsed: result.transactions,
        warnings: result.warnings,
        classifications: result.classifications ?? [],
        parentGenreIds: result.parentGenreIds ?? {},
      });
      await unpark(job.id);
      return;
    }

    const captured = createCapture
      ? await createCapture({
          imageBase64,
          transactions: result.transactions,
          warnings: result.warnings,
        })
      : ({ error: result.warnings[0] ?? '読み取れませんでした。' } as const);
    if (captured.error === null && captured.captureId !== null) {
      dispatch({
        type: 'captured',
        id: job.id,
        captureId: captured.captureId,
        receiptStatus: captured.receiptStatus,
      });
      await unpark(job.id);
    } else {
      dispatch({
        type: 'fail',
        id: job.id,
        error: captured.error ?? '読み取りに失敗しました。',
      });
    }
  } catch (e) {
    dispatch({
      type: 'fail',
      id: job.id,
      error: e instanceof Error ? e.message : '読み取りに失敗しました。',
    });
  }
}

/** 読み取り待ちにして、元の画像を端末へ置く(ページを閉じても失わない)。 */
async function park(id: string, file: File): Promise<void> {
  dispatch({ type: 'waiting', id });
  await saveWaitingFile({ id, blob: file, createdAt: Date.now() });
  ensureOnlineListener();
}

async function unpark(id: string): Promise<void> {
  files.delete(id);
  await deleteWaitingFile(id);
}

/** 読み取り待ちのジョブを、もう一度読み取りに回す。 */
export function retryWaitingJobs(): void {
  for (const job of state) {
    const file = files.get(job.id);
    if (job.status !== 'waiting' || file === undefined) continue;
    dispatch({ type: 'retry', id: job.id });
    waiting.push(() => process(job, file));
  }
  pump();
}

let onlineListenerAttached = false;
function ensureOnlineListener(): void {
  if (onlineListenerAttached || typeof window === 'undefined') return;
  onlineListenerAttached = true;
  window.addEventListener('online', () => retryWaitingJobs());
}

let restored = false;
/** 前回オフラインで撮ったまま残っているレシートを「読み取り待ち」として戻す(1回だけ)。 */
export async function restoreWaitingReceipts(): Promise<void> {
  if (restored || typeof window === 'undefined') return;
  restored = true;
  const saved = await loadWaitingFiles();
  for (const entry of saved) {
    if (state.some((j) => j.id === entry.id)) continue;
    const file = new File([entry.blob], `${entry.id}.jpg`, { type: entry.blob.type });
    files.set(entry.id, file);
    dispatch({
      type: 'add',
      job: { ...newJob(entry.id, URL.createObjectURL(file), entry.createdAt), status: 'waiting' },
    });
  }
  ensureOnlineListener();
  if (navigator.onLine) retryWaitingJobs();
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
