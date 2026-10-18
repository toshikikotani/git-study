'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { formatYen } from '@/domain/money';
import { useReceiptJobs } from '@/features/import/receipt-queue';
import type { MerchantNameReviewGroup } from '@/domain/merchant-name-review';
import { buildAttention } from '@/features/spending/views';
import {
  groupAttentionQueue,
  remainingAttentionQueue,
  type AttentionQueueItem,
} from '@/features/spending/attention-queue';
import { categoryHref } from '@/lib/category-nav';
import { pushUndo } from '@/lib/undo';
import { formatDateJa } from '@/lib/date';
import {
  recordGenreCorrectionAction,
  resolveReconcileAction,
  restoreRowFieldsAction,
  updateTransactionAction,
} from '../transactions/actions';
import type { DrilldownTransaction } from './drilldown';
import { useSpendingMonth } from './spending-month-provider';
import { MerchantNameReview } from './merchant-name-review';
import { JobRow } from './pending-receipt-rows';

/** 確認が残るときだけ出す共通の入口。月・口座・検索で全期間の未処理を隠さない。 */
export function AttentionCard({
  hasGoal,
  duplicateCount = 0,
  pendingInputCount,
  pendingCategoryCount,
  merchantNameGroups = [],
  merchantNameError = null,
}: {
  hasGoal: boolean;
  duplicateCount?: number;
  pendingInputCount?: number;
  pendingCategoryCount?: number;
  merchantNameGroups?: readonly MerchantNameReviewGroup[];
  merchantNameError?: string | null;
}) {
  const { transactions, captures, today, reloadVisibleMonth, visibleMonth } = useSpendingMonth();
  const router = useRouter();
  const jobs = useReceiptJobs();
  const shownJobs = jobs.filter(
    (job) =>
      !(job.status === 'needs_input' && captures.some((capture) => capture.id === job.captureId)),
  );
  const [view, setView] = useState<'closed' | 'hub' | 'records' | 'names'>('closed');
  const attention = useMemo(() => buildAttention(transactions, today), [transactions, today]);
  const queue = useMemo(
    () => groupAttentionQueue(transactions, attention),
    [attention, transactions],
  );
  const inputCount = pendingInputCount ?? captures.length;
  const categoryCount =
    pendingCategoryCount ?? transactions.filter((t) => t.reviewStatus === 'pending').length;
  const nameCount = merchantNameGroups.reduce((sum, group) => sum + group.entries.length, 0);
  // 同じ明細でも店名とカテゴリなど、別々の確認事項がある。バッジは確認項目数。
  const count =
    queue.length + inputCount + categoryCount + duplicateCount + nameCount + shownJobs.length;
  const summaries = [
    shownJobs.length > 0 ? `読み取り・保存待ち ${shownJobs.length}件` : '',
    inputCount > 0 ? `入力待ち ${inputCount}件` : '',
    categoryCount > 0 ? `カテゴリ確認 ${categoryCount}件` : '',
    attention.uncategorized.count > 0
      ? `未分類 ${attention.uncategorized.count}件${hasGoal ? '(目標に未反映)' : ''}`
      : '',
    attention.mismatch.count > 0 ? `金額不一致 ${attention.mismatch.count}件` : '',
    duplicateCount > 0 ? `重複 ${duplicateCount}組` : '',
    nameCount > 0 ? `店名のゆれ・店名なし ${nameCount}件` : '',
    merchantNameError ? '店名の確認を読み込めませんでした' : '',
  ].filter(Boolean);

  function close() {
    setView('closed');
    router.refresh();
    reloadVisibleMonth();
  }

  if (count === 0 && !merchantNameError) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setView('hub')}
        aria-label={`確認が必要。${count}項目`}
        className="flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left"
        style={{ background: 'var(--surface)', color: 'var(--ink)' }}
      >
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--state-caution-track)', color: 'var(--caution-mark)' }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6M12 17v.5" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-semibold">確認が必要</span>
          <span className="truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {summaries.join('・')}
          </span>
        </span>
        {count > 0 ? (
          <span
            className="tabular flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
            style={{ background: 'var(--caution-mark)', color: 'var(--surface)' }}
          >
            {count}
          </span>
        ) : null}
        <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
          ›
        </span>
      </button>

      <BottomSheet open={view === 'hub'} onClose={close} label="確認が必要">
        <BottomSheetHeader className="flex items-center justify-between gap-3">
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
            確認が必要
          </h2>
          <button
            type="button"
            onClick={close}
            className="min-h-11 px-2 text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            閉じる
          </button>
        </BottomSheetHeader>
        <p className="mb-3 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          入力待ち・カテゴリ確認・重複・店名はすべての月が対象です。
        </p>
        <div className="space-y-2 pb-4">
          {shownJobs.length > 0 ? (
            <ul aria-label="読み取り中・保存待ちのレシート" className="space-y-2">
              {shownJobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          ) : null}
          {inputCount > 0 ? (
            <ReviewLink
              href="/spending?review=input"
              title="入力待ちのレシート"
              detail={`${inputCount}件・画像を見ながら入力`}
            />
          ) : null}
          {categoryCount > 0 ? (
            <ReviewLink
              href="/spending?review=category"
              title="カテゴリ確認待ち"
              detail={`${categoryCount}件・自動で分けたカテゴリを確認`}
            />
          ) : null}
          {queue.length > 0 ? (
            <button
              type="button"
              onClick={() => setView('records')}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
              style={{ background: 'var(--plane)', color: 'var(--ink)' }}
            >
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">この月のカテゴリ・差額を直す</span>
                <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  {queue.length}件・1件ずつ確認
                </span>
              </span>
              <span aria-hidden>›</span>
            </button>
          ) : null}
          {attention.uncategorized.count > 0 ? (
            <ReviewLink
              href={categoryHref('none', visibleMonth)}
              title="未分類の明細を一覧で分ける"
              detail={`${attention.uncategorized.count}件・${formatYen(attention.uncategorized.yen)}${hasGoal ? '・目標に未反映' : ''}`}
            />
          ) : null}
          {nameCount > 0 ? (
            <button
              type="button"
              onClick={() => setView('names')}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
              style={{ background: 'var(--plane)', color: 'var(--ink)' }}
            >
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">店名をまとめて直す</span>
                <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  {nameCount}件・候補と対象を確認して保存
                </span>
              </span>
              <span aria-hidden>›</span>
            </button>
          ) : null}
          {merchantNameError ? (
            <p role="alert" className="px-2 py-3 text-sm" style={{ color: 'var(--over)' }}>
              {merchantNameError}
            </p>
          ) : null}
          {duplicateCount > 0 ? (
            <ReviewLink
              href="/transactions/duplicates"
              title="重複の確認"
              detail={`${duplicateCount}組・同じ買い物か確認`}
            />
          ) : null}
          <ReviewLink
            href="/transactions/reconcile"
            title="請求金額と突き合わせる"
            detail="カード会社のお知らせと明細を比較"
          />
        </div>
      </BottomSheet>
      <AttentionFixer open={view === 'records'} queue={queue} onClose={close} />
      <MerchantNameReview open={view === 'names'} groups={merchantNameGroups} onClose={close} />
    </>
  );
}

function ReviewLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link
      href={href as Route}
      prefetch={false}
      className="flex min-h-16 items-center justify-between gap-3 rounded-xl px-4 py-3"
      style={{ background: 'var(--plane)', color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {detail}
        </span>
      </span>
      <span aria-hidden>›</span>
    </Link>
  );
}

function AttentionFixer({
  open,
  queue,
  onClose,
}: {
  open: boolean;
  queue: AttentionQueueItem<DrilldownTransaction>[];
  onClose: () => void;
}) {
  const { genres } = useSpendingMonth();
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = remainingAttentionQueue(queue, handled);
  const current = remaining[0] ?? null;
  const total = queue.length;
  const position = total - remaining.length + 1;

  const markHandled = (key: string) => setHandled((prev) => new Set(prev).add(key));

  async function pickGenre(genreId: string): Promise<void> {
    if (!current) return;
    setBusy(true);
    setError(null);
    const result = await updateTransactionAction(current.tx.id, genreId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    void recordGenreCorrectionAction({
      storeName: current.tx.label,
      itemName: current.tx.label,
      genreId,
    });
    const key = `${current.reason}:${current.tx.id}`;
    markHandled(key);
    if (result.previous) {
      const previous = result.previous;
      pushUndo(`${current.tx.label} のカテゴリを変更しました`, async () => {
        const r = await restoreRowFieldsAction(previous);
        if (r.error) return r.error;
        setHandled((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        return null;
      });
    }
  }

  async function acceptDiff(): Promise<void> {
    if (!current) return;
    setBusy(true);
    setError(null);
    const result = await resolveReconcileAction([current.tx.id]);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const key = `${current.reason}:${current.tx.id}`;
    markHandled(key);
    if (result.previous) {
      const previous = result.previous;
      pushUndo(`${current.tx.label} の差額を認めました`, async () => {
        const r = await restoreRowFieldsAction(previous);
        if (r.error) return r.error;
        setHandled((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        return null;
      });
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} role="dialog">
      <div className="space-y-3 px-3 pb-3" aria-live="polite">
        {current === null ? (
          <div className="pb-4 text-center">
            <BottomSheetHeader className="pt-4">
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                ✓ 確認が必要なものはありません
              </p>
            </BottomSheetHeader>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 mt-3 rounded-full px-5 py-2 text-sm font-semibold"
              style={{ background: 'var(--action)', color: 'var(--on-action)' }}
            >
              閉じる
            </button>
          </div>
        ) : (
          <>
            <BottomSheetHeader className="flex items-baseline justify-between">
              <p className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                {position} / {total}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 text-xs"
                style={{ color: 'var(--ink-muted)' }}
              >
                あとで
              </button>
            </BottomSheetHeader>
            <div>
              {current.reasons.length > 1 ? (
                <p className="mb-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  この記録はカテゴリと差額を続けて確認します。
                </p>
              ) : null}
              <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                {current.tx.label}
                {current.tx.branchName ? (
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                    {current.tx.branchName}
                  </span>
                ) : null}
              </p>
              <p className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {formatDateJa(current.tx.occurredOn)} ・ {formatYen(-current.tx.amountYen)}
                {current.tx.items.length > 0
                  ? ` ・ ${current.tx.items
                      .slice(0, 3)
                      .map((i) => i.name)
                      .join('、')}`
                  : ''}
              </p>
            </div>

            {current.reason === 'uncategorized' ? (
              <div>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  カテゴリを選んでください
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {genres.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void pickGenre(g.id)}
                      className="min-h-11 rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
                  レシートの照合で {formatYen(Math.abs(current.tx.reconcileDiffYen ?? 0))}{' '}
                  の差額が残っています。 内容を確認して、問題なければ差額を認めてください。
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void acceptDiff()}
                    className="min-h-11 flex-1 rounded-full py-2 text-sm font-semibold disabled:opacity-50"
                    style={{ background: 'var(--action)', color: 'var(--on-action)' }}
                  >
                    この差額でOK
                  </button>
                  <button
                    type="button"
                    onClick={() => markHandled(`${current.reason}:${current.tx.id}`)}
                    className="min-h-11 rounded-full px-4 py-2 text-sm"
                    style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
                  >
                    スキップ
                  </button>
                </div>
              </div>
            )}
            {error ? (
              <p role="alert" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
