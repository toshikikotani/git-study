'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { formatYen } from '@/domain/money';
import { buildAttention } from '@/features/spending/views';
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

/**
 * 要確認カード:未分類と金額不一致の件数・金額。対象が無ければ何も出さない。
 * 明細の各行には赤字のエラーを出さず、確認が要るものはここに集約する。
 * タップすると、1件ずつ順番に直せる(ジャンルを選ぶ/差額を認める)。
 * 目標があるとき、未分類は「目標に未反映」として出す(ジャンルが決まらないと
 * 目標のジャンル別の実績に入らないため)。
 */
export function AttentionCard({ hasGoal }: { hasGoal: boolean }) {
  const { transactions, today, reloadVisibleMonth, captures, visibleMonth } = useSpendingMonth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const attention = useMemo(() => buildAttention(transactions, today), [transactions, today]);
  const queue = useMemo(() => {
    const byId = new Map(transactions.map((t) => [t.id, t]));
    const items: { tx: DrilldownTransaction; reason: 'uncategorized' | 'mismatch' }[] = [];
    for (const id of attention.uncategorized.ids) {
      const tx = byId.get(id);
      if (tx) items.push({ tx, reason: 'uncategorized' });
    }
    for (const id of attention.mismatch.ids) {
      const tx = byId.get(id);
      if (tx) items.push({ tx, reason: 'mismatch' });
    }
    return items;
  }, [attention, transactions]);

  if (queue.length === 0 && captures.length === 0) return null;

  return (
    <>
      <div
        className="glass w-full rounded-2xl p-4"
        style={{
          background: 'var(--attention-track)',
          boxShadow: 'var(--card-shadow)',
          border: '1px solid var(--state-caution)',
        }}
      >
        {queue.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="block min-h-11 w-full text-left"
            aria-label={`要確認 ${queue.length}件。タップして順番に直す`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                <span aria-hidden>▲ </span>要確認
              </p>
              <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                順番に直す →
              </span>
            </div>
            <ul
              className="tabular mt-2 space-y-1 text-xs"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {attention.uncategorized.count > 0 ? (
                <li>
                  未分類 {attention.uncategorized.count}件・{formatYen(attention.uncategorized.yen)}
                  {hasGoal ? '(目標に未反映)' : ''}
                </li>
              ) : null}
              {attention.mismatch.count > 0 ? (
                <li>
                  金額不一致 {attention.mismatch.count}件・差額 {formatYen(attention.mismatch.yen)}
                </li>
              ) : null}
            </ul>
          </button>
        ) : (
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <span aria-hidden>▲ </span>要確認
          </p>
        )}
        {attention.uncategorized.count > 0 ? (
          <Link
            href={categoryHref('none', visibleMonth) as Route}
            prefetch={false}
            className="mt-1 flex min-h-11 items-center justify-between gap-3 text-xs"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <span>未分類の明細を一覧で分類する</span>
            <span className="shrink-0 font-semibold" style={{ color: 'var(--ink)' }}>
              開く →
            </span>
          </Link>
        ) : null}
        {captures.length > 0 ? (
          <Link
            href={`/transactions/receipt/${captures[0]!.id}` as Route}
            prefetch={false}
            className="mt-1 flex min-h-11 items-center justify-between gap-3 text-xs"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <span className="tabular">
              入力待ち {captures.length}件{'(集計に入っていません'}
              {hasGoal ? '・目標に未反映' : ''}
              {')'}
            </span>
            <span className="shrink-0 font-semibold" style={{ color: 'var(--ink)' }}>
              入力する →
            </span>
          </Link>
        ) : null}
      </div>

      <AttentionFixer
        open={open}
        queue={queue}
        onClose={() => {
          setOpen(false);
          router.refresh();
          reloadVisibleMonth();
        }}
      />
    </>
  );
}

function AttentionFixer({
  open,
  queue,
  onClose,
}: {
  open: boolean;
  queue: { tx: DrilldownTransaction; reason: 'uncategorized' | 'mismatch' }[];
  onClose: () => void;
}) {
  const { genres } = useSpendingMonth();
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = queue.filter((q) => !handled.has(`${q.reason}:${q.tx.id}`));
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
      pushUndo(`${current.tx.label} のジャンルを変更しました`, async () => {
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
          <div className="py-4 text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              ✓ 確認が必要なものはありません
            </p>
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
            <div className="flex items-baseline justify-between">
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
            </div>
            <div>
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
                  ジャンルを選んでください
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
