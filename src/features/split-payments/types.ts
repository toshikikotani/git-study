import { z } from 'zod';

import { MAX_YEN } from '@/domain/money';
import { buildSplitPaymentRequest, type SplitPaymentEntry } from '@/domain/split-payment-request';

export type TrackedSplitPayment = {
  id: string;
  signature: string;
  entries: readonly SplitPaymentEntry[];
  participants: number;
  totalYen: number;
  amountPerPersonYen: number;
  receivedCount: number;
  version: number;
  createdAt: string;
};

export type TrackingStorage = 'database' | 'browser';
export type TrackingListResult = {
  userId: string | null;
  storage: TrackingStorage;
  requests: TrackedSplitPayment[];
  error: string | null;
  /** 端末の受取人数とDBの受取人数が異なり、本人の選択が必要な依頼の署名。 */
  conflicts?: readonly string[];
};
export type TrackingSaveResult = {
  userId: string | null;
  storage: TrackingStorage;
  request: TrackedSplitPayment | null;
  error: string | null;
};

export const MAX_TRACKING_IMPORT = 100;
export const trackingIdSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const entrySchema = z.object({
  id: trackingIdSchema,
  occurredOn: z.iso.date(),
  label: z.string().max(1000),
  branchName: z.string().max(1000).nullable(),
  amountYen: z.number().int().min(-MAX_YEN).max(-1),
  status: z.literal('actual'),
  kind: z.enum(['normal', 'special']),
  isTransfer: z.literal(false),
  reviewStatus: z.enum(['auto_ok', 'pending', 'confirmed', 'corrected']),
  needsInput: z.literal(false),
});

export const splitPaymentTrackingInputSchema = z.object({
  entries: z.array(entrySchema).min(1).max(1000),
  participants: z.number().int().min(2).max(MAX_YEN),
});

const trackedSchema = splitPaymentTrackingInputSchema.extend({
  id: trackingIdSchema,
  signature: z.string().regex(/^[0-9a-f]{64}$/),
  totalYen: safeInteger.min(1).max(MAX_YEN),
  amountPerPersonYen: safeInteger.min(1).max(MAX_YEN),
  receivedCount: safeInteger,
  version: safeInteger,
  createdAt: z.iso.datetime({ offset: true }),
});

/** DB・ブラウザ保存の双方を同じ規則で検査する。署名の再計算はサーバーが行う。 */
export function parseTrackedSplitPayment(value: unknown): TrackedSplitPayment {
  const parsed = trackedSchema.safeParse(value);
  if (!parsed.success) throw new Error('保存された割り勘の内容を確認できませんでした。');
  const snapshot = parsed.data;
  const request = buildSplitPaymentRequest(snapshot.entries, snapshot.participants);
  if (
    request.entries.length !== snapshot.entries.length ||
    request.totalYen !== snapshot.totalYen ||
    request.amountPerPersonYen !== snapshot.amountPerPersonYen ||
    snapshot.receivedCount > snapshot.participants - 1
  ) {
    throw new Error('保存された割り勘の金額と受取人数を確認してください。');
  }
  return { ...snapshot, entries: request.entries };
}
