'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { goalImpact, goalToastMessage } from '@/domain/goal-impact';
import { formatYen } from '@/domain/money';
import type { CheckLevel } from '@/domain/receipt-questions';
import { splitReadResult } from '@/domain/unsaved-receipt';
import {
  checkQuestions,
  checkSavePlan,
  currentParsed,
  genreCorrections,
  initialCheckState,
  isComplete,
  paidYenOf,
  type CheckContext,
  type CheckState,
} from '@/features/import/receipt-check';
import {
  hideUnsavedReceipt,
  removeReceiptJob,
  retryWaitingJobs,
  unhideUnsavedReceipt,
  useHiddenReceiptKeys,
  useReceiptJobs,
  type ReceiptJob,
} from '@/features/import/receipt-queue';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import { mergeUnsavedReceipts, type UnsavedReceipt } from '@/features/import/unsaved-receipts';
import type { ReadyReceiptView } from '@/features/receipt-captures/types';
import { markJustSaved } from '@/lib/just-saved';
import { useGenreChoices } from '../../genre-picker-sheet';
import { loadGoalSnapshotAction } from '../../plan/actions';
import {
  checkReceiptDuplicatesAction,
  mergeReceiptIntoPaymentAction,
  recordGenreCorrectionAction,
  saveImportBatchAction,
  undoReceiptSaveAction,
  type ReceiptDuplicateHit,
} from '../actions';
import { useInputAccount } from '../input-account';
import {
  discardCaptureAction,
  readyImagePathAction,
  resolveReadyCaptureAction,
  restoreCaptureAction,
} from './capture-actions';
import { InlineToast, ReceiptCheck } from './receipt-check';

/**
 * 保存前のレシート(v5 変更2、ADR-133)。明細の「確認が必要」のいちばん上に出す。
 *
 * 撮ったレシートは裏で読み取られ(features/import/receipt-queue.ts)、読み取れたものはサーバーに
 * 「保存前」として残る(閉じても消えない)。ここでは、読み取り中の仮の行 → 保存前の一覧の順に出す。
 * 1件を押すと確かめる画面(receipt-check.tsx)がシートで開く。保存は本人が「保存」を押したときだけ
 * (読み取りが完璧でも、押すまで明細に入らない)。確かめる所がないものが2件以上あるときだけ、
 * 「そろっている N件を保存」を出す(押す前に、保存する店名と金額を見せる)。保存したあとは
 * 「元に戻す」つきの知らせを出す。
 *
 * ── 経緯 ──────────────────────────────────────────────────
 * 現金・電子マネーなど通知メールもカード明細も無い支払いの主経路(ADR-021)。
 * もとは、合計が合い自信も高ければ画面に出て0.3秒で自動で保存していた(ADR-133 でやめた)。
 */

type Toast = {
  message: string;
  undo: (() => Promise<string | null>) | null;
  undoing: boolean;
};

type Probe = { key: string; storeName: string; occurredOn: string; amountYen: number };

/** 同じ支払いかもしれない記録を、保存前の全部についてまとめて確かめる(直したら取り直す)。 */
function useDuplicateHits(probes: readonly Probe[]): ReadonlyMap<string, ReceiptDuplicateHit[]> {
  const signature = JSON.stringify(probes);
  const [hits, setHits] = useState<ReadonlyMap<string, ReceiptDuplicateHit[]>>(new Map());
  useEffect(() => {
    const list = JSON.parse(signature) as Probe[];
    if (list.length === 0) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void checkReceiptDuplicatesAction(list)
        .then((r) => {
          if (alive) setHits(new Map(Object.entries(r.duplicates)));
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [signature]);
  return hits;
}

async function imageBase64Of(receipt: UnsavedReceipt): Promise<string | null> {
  if (receipt.imageBase64) return receipt.imageBase64;
  if (!receipt.imageUrl) return null;
  const blob = await fetch(receipt.imageUrl).then((r) => (r.ok ? r.blob() : null));
  return blob ? resizeToJpegBase64(new File([blob], 'receipt.jpg', { type: blob.type })) : null;
}

export function ReceiptResults({
  ready = [],
  checkLevel = 'normal',
  openFirst = false,
}: {
  /** サーバーに残っている保存前のレシート。 */
  ready?: readonly ReadyReceiptView[];
  checkLevel?: CheckLevel;
  /** 撮ったあとの「確かめる」から来たら、1件めを開く。 */
  openFirst?: boolean;
}) {
  const router = useRouter();
  const jobs = useReceiptJobs();
  const hidden = useHiddenReceiptKeys();
  const choices = useGenreChoices();
  const genres = useMemo(() => choices?.genres ?? [], [choices]);
  const inputAccount = useInputAccount('', { autoCreateDefault: true });
  const accounts = useMemo(
    () => (inputAccount.accounts ?? []).map((a) => ({ id: a.id, name: a.name })),
    [inputAccount.accounts],
  );
  const defaultAccountId = inputAccount.accountId || null;

  const [goal, setGoal] = useState<{ snapshot: GoalSnapshot; today: string } | null>(null);
  const [joined, setJoined] = useState<ReadonlyMap<string, UnsavedReceipt>>(new Map());
  const [states, setStates] = useState<ReadonlyMap<string, CheckState>>(new Map());
  const [merge, setMerge] = useState<ReadonlyMap<string, 'merge' | 'separate'>>(new Map());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [joining, setJoining] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openedFirst = useRef(false);

  useEffect(() => {
    void loadGoalSnapshotAction()
      .then((r) => {
        if (!r.error) setGoal(r.snapshot ? { snapshot: r.snapshot, today: r.today } : null);
      })
      .catch(() => undefined);
  }, []);

  const receipts = useMemo(
    () => mergeUnsavedReceipts(ready, jobs, hidden).map((r) => joined.get(r.key) ?? r),
    [ready, jobs, hidden, joined],
  );
  const ctx = useMemo<CheckContext>(
    () => ({ level: checkLevel, goalRange: goal?.snapshot.range ?? null }),
    [checkLevel, goal],
  );
  const stateOf = useCallback(
    (r: UnsavedReceipt): CheckState => {
      const initial = initialCheckState(r, defaultAccountId);
      const s = states.get(r.key);
      if (!s) return initial;
      return s.accountId ? s : { ...s, accountId: initial.accountId };
    },
    [states, defaultAccountId],
  );
  const probes = useMemo(
    () =>
      receipts.map((r) => {
        const s = stateOf(r);
        return {
          key: r.key,
          storeName: s.store,
          occurredOn: s.occurredOn,
          amountYen: -paidYenOf(s),
        };
      }),
    [receipts, stateOf],
  );
  const duplicates = useDuplicateHits(probes);

  // 撮ったあとの「確かめる」から来たら、1件めを開く(1回だけ)。
  useEffect(() => {
    if (!openFirst || openedFirst.current || receipts.length === 0) return;
    openedFirst.current = true;
    setOpenKey(receipts[0]!.key);
  }, [openFirst, receipts]);

  const change = (r: UnsavedReceipt) => (update: (s: CheckState) => CheckState) =>
    setStates((prev) => new Map(prev).set(r.key, update(prev.get(r.key) ?? stateOf(r))));

  /** 1件を保存する。保存した記録の id と知らせの文を返す。 */
  const saveOne = async (
    r: UnsavedReceipt,
    s: CheckState,
  ): Promise<{ ids: string[]; message: string } | { error: string }> => {
    const plan = checkSavePlan(r, s, crypto.randomUUID());
    let imagePath = r.imagePath ?? (r.captureId ? await readyImagePathAction(r.captureId) : null);
    const warnings: string[] = [];
    if (imagePath === null && r.imageBase64) {
      try {
        const res = await fetch('/api/import/receipt/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image: r.imageBase64, mediaType: 'image/jpeg' }),
        });
        const uploaded = (await res.json()) as { path: string | null; error: string | null };
        imagePath = uploaded.path;
        if (uploaded.error) warnings.push(uploaded.error);
      } catch {
        warnings.push('レシート画像を保存できませんでした。');
      }
    }
    const choice = merge.get(r.key) ?? null;
    const hit = duplicates.get(r.key)?.[0] ?? null;
    const sourceRef = plan.transaction.sourceRef!;
    const outcome = await saveImportBatchAction(
      [plan.transaction],
      {
        fileName: 'レシート撮影',
        source: 'manual',
        accountId: s.accountId ?? '',
        failedCount: 0,
        receiptImagePath: imagePath,
        keepSeparate: choice === 'separate',
      },
      plan.splits ? [{ sourceRef, splits: plan.splits }] : [],
      plan.items.length > 0 ? [{ sourceRef, items: plan.items }] : [],
      plan.expenseSubtype ? [{ sourceRef, subtype: plan.expenseSubtype }] : [],
    );
    if (outcome.error) return { error: outcome.error };
    const insertedId = outcome.insertedIds[0] ?? null;
    if (r.captureId) await resolveReadyCaptureAction(r.captureId, insertedId);
    if (choice === 'merge' && insertedId && hit) {
      const merged = await mergeReceiptIntoPaymentAction(insertedId, hit.id);
      if (merged.error) warnings.push(merged.error);
    }
    // 直したカテゴリは履歴へ(次から同じ品名のおすすめに出る)。「次から同じ品名は」はルールにする。
    void Promise.allSettled(
      genreCorrections(r, s).map((c) =>
        recordGenreCorrectionAction({
          storeName: s.store,
          itemName: c.itemName,
          genreId: c.genreId,
          ...(c.pin ? { pin: true, anyStore: true } : {}),
        }),
      ),
    );
    markJustSaved(outcome.insertedIds);
    hideUnsavedReceipt(r.key);
    const label = `${s.store} ${formatYen(paidYenOf(s))}`;
    const impact =
      goal === null
        ? null
        : goalImpact(goal.snapshot, {
            occurredOn: s.occurredOn,
            today: goal.today,
            kind: 'normal',
            deltas: currentParsed(r, s).items.map((i) => ({
              genreId: s.genreByLineId.get(i.lineId ?? '') ?? null,
              amountYen: Math.abs(i.amountYen),
            })),
          });
    const message =
      outcome.imported === 0
        ? `${label} は登録済みなので、増やしませんでした`
        : impact !== null && goal !== null && impact.rows.length > 0
          ? goalToastMessage({ label, impact, goal: goal.snapshot, today: goal.today })
          : `${label} を保存しました${warnings.length > 0 ? `(${warnings[0]})` : ''}`;
    return { ids: outcome.insertedIds, message };
  };

  const undoSaved = (items: readonly { r: UnsavedReceipt; ids: string[] }[]) => async () => {
    const result = await undoReceiptSaveAction(items.flatMap((i) => i.ids));
    if (result.error) return result.error;
    for (const { r } of items) {
      if (r.captureId) await restoreCaptureAction(r.captureId, 'ready');
      unhideUnsavedReceipt(r.key);
    }
    router.refresh();
    return null;
  };

  const afterDone = (key: string) => {
    if (openKey !== key) return;
    const rest = receipts.filter((r) => r.key !== key);
    const at = receipts.findIndex((r) => r.key === key);
    setOpenKey(rest.length === 0 ? null : (rest[Math.min(at, rest.length - 1)]?.key ?? null));
  };

  const save = async (r: UnsavedReceipt) => {
    if (saving.has(r.key)) return;
    setSaving((prev) => new Set(prev).add(r.key));
    setError(null);
    try {
      const result = await saveOne(r, stateOf(r));
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setToast({
        message: result.message,
        undo: undoSaved([{ r, ids: result.ids }]),
        undoing: false,
      });
      afterDone(r.key);
      router.refresh();
    } catch {
      setError(
        '保存できませんでした。読み取り結果は残っています。もう一度「保存」を押してください。',
      );
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(r.key);
        return next;
      });
    }
  };

  const discard = async (r: UnsavedReceipt) => {
    if (r.captureId) {
      const result = await discardCaptureAction(r.captureId).catch(() => ({
        error: '捨てられませんでした。',
      }));
      if (result.error) {
        setError(result.error);
        return;
      }
    }
    hideUnsavedReceipt(r.key);
    afterDone(r.key);
    setToast({
      message: `${stateOf(r).store} のレシートを捨てました`,
      undo: async () => {
        if (r.captureId) {
          const restored = await restoreCaptureAction(r.captureId, 'ready');
          if (restored.error) return restored.error;
        }
        unhideUnsavedReceipt(r.key);
        router.refresh();
        return null;
      },
      undoing: false,
    });
    router.refresh();
  };

  /** 長いレシートを2枚で撮ったとき:次の保存前のレシートと1枚につなげて読み直す。 */
  const joinNext = async (r: UnsavedReceipt, next: UnsavedReceipt) => {
    setJoining(true);
    setError(null);
    try {
      const [first, second] = await Promise.all([imageBase64Of(r), imageBase64Of(next)]);
      if (!first || !second) throw new Error('image');
      const res = await fetch('/api/import/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          image: first,
          moreImages: [second],
          mediaType: 'image/jpeg',
          ...(r.captureId ? { replaceReadyId: r.captureId } : {}),
        }),
      });
      const data = (await res.json()) as {
        transactions?: UnsavedReceipt['parsed'][];
        warnings?: string[];
        classifications?: UnsavedReceipt['classifications'];
        parentGenreIds?: Record<number, string>;
        accountGuesses?: Record<number, NonNullable<UnsavedReceipt['accountGuess']>>;
      };
      const [payload] = splitReadResult({
        transactions: (data.transactions ?? []).slice(0, 1),
        warnings: data.warnings ?? [],
        classifications: data.classifications ?? [],
        parentGenreIds: data.parentGenreIds ?? {},
        accountGuesses: data.accountGuesses ?? {},
      });
      if (!payload) {
        setError(data.warnings?.[0] ?? 'つなげて読み直せませんでした。');
        return;
      }
      setJoined((prev) => new Map(prev).set(r.key, { ...r, ...payload }));
      setStates((prev) => {
        const nextStates = new Map(prev);
        nextStates.delete(r.key);
        return nextStates;
      });
      if (next.captureId) await discardCaptureAction(next.captureId).catch(() => undefined);
      hideUnsavedReceipt(next.key);
      setToast({ message: '2枚を1枚のレシートにつなげました', undo: null, undoing: false });
    } catch {
      setError('つなげて読み直せませんでした。通信を確かめて、もう一度押してください。');
    } finally {
      setJoining(false);
    }
  };

  const complete = receipts.filter(
    (r) => isComplete(r, stateOf(r), ctx) && (duplicates.get(r.key)?.length ?? 0) === 0,
  );
  const saveComplete = async () => {
    if (bulkSaving) return;
    setBulkSaving(true);
    setError(null);
    const done: { r: UnsavedReceipt; ids: string[] }[] = [];
    try {
      for (const r of complete) {
        const result = await saveOne(r, stateOf(r));
        if ('error' in result) {
          setError(result.error);
          break;
        }
        done.push({ r, ids: result.ids });
      }
    } catch {
      setError('保存できなかったレシートがあります。残りは一覧に残っています。');
    } finally {
      setBulkSaving(false);
    }
    if (done.length > 0) {
      setToast({
        message: `${done.length}件を保存しました`,
        undo: undoSaved(done),
        undoing: false,
      });
      router.refresh();
    }
  };

  const runUndo = async () => {
    if (!toast?.undo) return;
    setToast({ ...toast, undoing: true });
    const result = await toast.undo().catch(() => '元に戻せませんでした。');
    if (result) setToast({ message: result, undo: null, undoing: false });
    else setToast(null);
  };
  const toastNode = toast ? (
    <InlineToast
      message={toast.message}
      onUndo={toast.undo ? () => void runUndo() : null}
      undoing={toast.undoing}
      onClose={() => setToast(null)}
    />
  ) : null;

  const reading = jobs.filter((j) => j.status === 'reading');
  const parked = jobs.filter((j) => j.status === 'waiting' || j.status === 'needs_input');
  const failed = jobs.filter((j) => j.status === 'error');
  const openIndex = receipts.findIndex((r) => r.key === openKey);
  const current = openIndex >= 0 ? receipts[openIndex]! : null;

  if (
    receipts.length === 0 &&
    reading.length === 0 &&
    parked.length === 0 &&
    failed.length === 0 &&
    toast === null
  )
    return null;

  return (
    <section aria-label="保存前のレシート" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-1">
        <h2 className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
          保存前のレシート{receipts.length > 0 ? ` ${receipts.length}件` : ''}
        </h2>
        {receipts.length > 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            「保存」を押すまで、明細には入りません
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {inputAccount.error ? (
        <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          {inputAccount.error}{' '}
          <button
            type="button"
            onClick={inputAccount.retry}
            className="min-h-11 font-semibold underline"
          >
            もう一度
          </button>
        </p>
      ) : null}

      {/* そろっているものが2件以上:押す前に、保存する店名と金額を見せる。 */}
      {complete.length >= 2 ? (
        <div
          className="flex flex-col gap-2 rounded-2xl px-4 py-3"
          style={{ background: 'var(--surface)', color: 'var(--ink)' }}
        >
          <p className="text-[15px] font-semibold">確かめる所がないレシート {complete.length}件</p>
          <ul className="flex flex-col gap-1 text-[15px]" aria-label="まとめて保存するレシート">
            {complete.map((r) => {
              const s = stateOf(r);
              return (
                <li key={r.key} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{s.store}</span>
                  <span className="tabular shrink-0">{formatYen(paidYenOf(s))}</span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => void saveComplete()}
            disabled={bulkSaving}
            className="btn-primary min-h-12 rounded-full text-[17px] font-semibold"
          >
            {bulkSaving ? '保存しています…' : `そろっている ${complete.length}件を保存`}
          </button>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {reading.map((job) => (
          <li
            key={job.id}
            role="status"
            aria-label="読み取り中"
            className="flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--surface)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={job.previewUrl}
              alt=""
              className="h-13 w-11 shrink-0 rounded-lg object-cover"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span
                className="h-3 w-2/3 animate-pulse rounded-lg"
                style={{ background: 'var(--hairline)' }}
              />
              <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                読み取り中…
              </span>
            </span>
          </li>
        ))}

        {receipts.map((r) => {
          const s = stateOf(r);
          const questions = checkQuestions(r, s, ctx);
          const ok = complete.includes(r);
          const must = questions.some((q) => q.ask === 'must');
          return (
            <li
              key={r.key}
              className="flex items-center gap-2 rounded-2xl pr-3"
              style={{ background: 'var(--surface)' }}
            >
              <button
                type="button"
                onClick={() => setOpenKey(r.key)}
                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                style={{ color: 'var(--ink)' }}
              >
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt=""
                    className="h-13 w-11 shrink-0 rounded-lg object-cover"
                  />
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-[15px] font-semibold">{s.store}</span>
                  <span className="tabular text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    {Number(s.occurredOn.slice(5, 7))}/{Number(s.occurredOn.slice(8, 10))} ·{' '}
                    {formatYen(paidYenOf(s))}
                  </span>
                  <span
                    className="text-[13px]"
                    style={{ color: ok ? 'var(--ink-muted)' : 'var(--state-caution)' }}
                  >
                    {ok
                      ? 'そろっています'
                      : (duplicates.get(r.key)?.length ?? 0) > 0
                        ? '同じ支払いかも'
                        : questions.length > 0
                          ? `確かめること ${questions.length}つ${must ? '' : '(答えなくても保存できます)'}`
                          : '確かめてから保存'}
                  </span>
                </span>
              </button>
              {ok ? (
                <button
                  type="button"
                  onClick={() => void save(r)}
                  disabled={saving.has(r.key)}
                  className="btn-primary min-h-11 shrink-0 rounded-full px-4 text-[15px] font-semibold"
                >
                  {saving.has(r.key) ? '保存中…' : '保存'}
                </button>
              ) : (
                <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
                  ›
                </span>
              )}
            </li>
          );
        })}

        {parked.map((job) => (
          <ParkedJobCard key={job.id} job={job} />
        ))}

        {failed.map((job) => (
          <li
            key={job.id}
            role="alert"
            className="flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={job.previewUrl}
              alt=""
              className="h-13 w-11 shrink-0 rounded-lg object-cover"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[15px] font-semibold">読み取れませんでした</span>
              <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {job.error ?? '撮り直してください。'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => removeReceiptJob(job.id)}
              className="min-h-11 shrink-0 px-2 text-[15px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              閉じる
            </button>
          </li>
        ))}
      </ul>

      {openKey === null && toastNode ? (
        <div className="fixed inset-x-4 bottom-28 z-40 mx-auto max-w-md">{toastNode}</div>
      ) : null}

      <BottomSheet
        open={current !== null}
        onClose={() => setOpenKey(null)}
        tall
        label="レシートを確かめる"
      >
        {current ? (
          <ReceiptCheck
            key={current.key}
            receipt={current}
            state={stateOf(current)}
            onChange={change(current)}
            ctx={ctx}
            genres={genres}
            accounts={accounts}
            goal={goal}
            position={{ index: openIndex, total: receipts.length }}
            saving={saving.has(current.key)}
            duplicates={duplicates.get(current.key) ?? []}
            mergeChoice={merge.get(current.key) ?? null}
            onMergeChoice={(choice) => setMerge((prev) => new Map(prev).set(current.key, choice))}
            onSave={() => void save(current)}
            onNext={
              receipts.length > 1
                ? () => setOpenKey(receipts[(openIndex + 1) % receipts.length]!.key)
                : null
            }
            onDiscard={() => void discard(current)}
            onJoinNext={
              openIndex + 1 < receipts.length
                ? () => void joinNext(current, receipts[openIndex + 1]!)
                : null
            }
            joining={joining}
            toast={toastNode}
          />
        ) : null}
      </BottomSheet>
    </section>
  );
}

/**
 * 読み取り待ち(圏外)と入力待ち(読み取れなかった)のカード。どちらも画像は残してあり、
 * 「失敗」とは呼ばない。入力待ちは手入力の画面へ、読み取り待ちは戻れば自動で読み取る。
 */
function ParkedJobCard({ job }: { job: ReceiptJob }) {
  return (
    <li
      className="flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={job.previewUrl} alt="" className="h-13 w-11 shrink-0 rounded-lg object-cover" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[15px] font-semibold">
          {job.status === 'waiting' ? '読み取り待ち' : '入力待ち'}
        </span>
        <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          {job.status === 'waiting'
            ? 'オンラインに戻ると自動で読み取ります。画像は端末に残してあります。'
            : job.receiptStatus === 'partial'
              ? '一部だけ読み取れました。残りを入力してください。'
              : '読み取れませんでした。画像を見ながら入力できます。'}
        </span>
      </span>
      {job.status === 'waiting' ? (
        <button
          type="button"
          onClick={() => retryWaitingJobs()}
          className="min-h-11 shrink-0 px-2 text-[13px] font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          今すぐ読み取る →
        </button>
      ) : (
        <Link
          href={`/transactions/receipt/${job.captureId}` as Route}
          prefetch={false}
          className="flex min-h-11 shrink-0 items-center px-2 text-[13px] font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          入力する →
        </Link>
      )}
    </li>
  );
}
