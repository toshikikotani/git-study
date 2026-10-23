/**
 * 保存前のレシート(v5 変更2、ADR-133)を、画面で1つの並びにする。
 *
 * サーバーに残した保存前(receipt_captures の status = 'ready')と、撮ったばかりで画面の中にだけある
 * 読み取り結果(サーバーに残せなかったとき・残した直後で画面がまだ読み直していないとき)を合わせる。
 * 同じものはサーバーの方を使う(id で重ねない)。並びは撮った順。
 */

import type { AccountGuess } from '@/domain/receipt-account';
import type { ReceiptGenreGuess } from '@/domain/unsaved-receipt';
import { splitReadResult } from '@/domain/unsaved-receipt';
import type { ReadyReceiptView } from '@/features/receipt-captures/types';
import type { ParsedReceiptTransaction } from './receipt-ai';
import type { ReceiptJob } from './receipt-queue';

export type UnsavedReceipt = {
  /** 画面の中での一意な鍵(サーバーに残っていれば行の id)。 */
  key: string;
  /** サーバーに残した行の id(画面の中にだけあれば null)。 */
  captureId: string | null;
  /** 撮影のキューのジョブ(画面の中にあれば)。 */
  jobId: string | null;
  /** ジョブの中の何件め(1枚に2件以上写っていたとき)。 */
  index: number;
  imageUrl: string | null;
  /** 画面の中にだけあるときの画像(保存のときに上げる)。 */
  imageBase64: string | null;
  /** サーバーに残した画像のパス(保存のときに明細へ付ける)。 */
  imagePath: string | null;
  parsed: ParsedReceiptTransaction;
  warnings: string[];
  classifications: ReceiptGenreGuess[];
  parentGenreId: string | null;
  accountGuess: AccountGuess | null;
  /** 撮った日('YYYY-MM-DD')。日付を聞くときの候補にする。 */
  capturedOn: string;
  createdAt: number;
};

const dateOf = (ms: number) => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); // 日本時間の日付

export function fromServer(view: ReadyReceiptView): UnsavedReceipt {
  return {
    key: view.id,
    captureId: view.id,
    jobId: null,
    index: 0,
    imageUrl: view.imageUrl,
    imageBase64: null,
    imagePath: view.imagePath,
    parsed: view.parsed,
    warnings: view.warnings,
    classifications: view.classifications,
    parentGenreId: view.parentGenreId,
    accountGuess: view.accountGuess,
    capturedOn: view.capturedOn,
    createdAt: Date.parse(view.createdAt) || 0,
  };
}

export function fromJob(job: ReceiptJob): UnsavedReceipt[] {
  if (job.status !== 'ready') return [];
  return splitReadResult({
    transactions: job.parsed,
    warnings: job.warnings,
    classifications: job.classifications,
    parentGenreIds: job.parentGenreIds,
    accountGuesses: job.accountGuesses,
  }).map((payload, index) => {
    const captureId = job.readyIds?.[index] ?? null;
    return {
      ...payload,
      key: captureId ?? `${job.id}:${index}`,
      captureId,
      jobId: job.id,
      index,
      imageUrl: job.previewUrl,
      imageBase64: job.imageBase64,
      imagePath: null,
      capturedOn: dateOf(job.createdAt),
      createdAt: job.createdAt + index,
    };
  });
}

/** サーバーの保存前と画面の中の読み取り結果を合わせる。done(保存した・捨てた鍵)は出さない。 */
export function mergeUnsavedReceipts(
  server: readonly ReadyReceiptView[],
  jobs: readonly ReceiptJob[],
  done: ReadonlySet<string> = new Set(),
): UnsavedReceipt[] {
  const fromDb = server.map(fromServer);
  const known = new Set(fromDb.map((r) => r.key));
  const local = jobs.flatMap(fromJob).filter((r) => !known.has(r.key));
  return [...fromDb, ...local]
    .filter((r) => !done.has(r.key))
    .sort((a, b) => a.createdAt - b.createdAt);
}
