'use client';

import { useMemo, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { monthSpendingText } from '@/domain/month-spending-text';
import { useSpendingMonth } from './spending-month-provider';

/**
 * 表示中の月の支出を、文字でコピーする(本人「1ヶ月分の支出を出力する機能欲しい」、ADR-134)。
 * 押すとシートに中身を出し、「コピー」で貼れる文字にする(LINE やメモへ)。送れる端末なら「送る」も出す。
 * 数字は明細の「支出」とカテゴリ別の内訳と同じ値。
 */
export function MonthCopy() {
  const { transactions, genreBreakdown, totals, accounts, visibleMonth, today, loading } =
    useSpendingMonth();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const text = useMemo(() => {
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    return monthSpendingText({
      monthStart: visibleMonth,
      today,
      rows: transactions,
      spentYen: totals.spentYen,
      scheduledYen: totals.scheduledYen,
      genreBreakdown,
      accountName: (id) => names.get(id) ?? null,
    });
  }, [accounts, visibleMonth, today, transactions, totals, genreBreakdown]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setState('idle');
          setOpen(true);
        }}
        disabled={loading}
        className="flex min-h-11 items-center gap-2 self-end px-1 text-[13px] font-semibold disabled:opacity-40"
        style={{ color: 'var(--accent)' }}
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
        この月の支出をコピー
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} role="dialog" label="この月の支出">
        <div className="flex flex-col gap-3 px-3 pb-4" style={{ color: 'var(--ink)' }}>
          <BottomSheetHeader>
            <p className="py-2 text-[17px] font-semibold">この月の支出</p>
          </BottomSheetHeader>
          <textarea
            readOnly
            value={text}
            aria-label="コピーする文字"
            rows={14}
            className="w-full resize-none rounded-xl px-3 py-2 text-[13px] leading-relaxed"
            style={{ background: 'var(--field)', color: 'var(--ink)' }}
          />
          <p role="status" className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {state === 'copied'
              ? 'コピーしました。LINE やメモに貼れます。'
              : state === 'failed'
                ? 'コピーできませんでした。上の文字を長押しして選んでください。'
                : '保存前・入力待ちのレシートと、今日より先の予定は入っていません。'}
          </p>
          <div className="flex gap-2">
            {canShare ? (
              <button
                type="button"
                onClick={() => void navigator.share({ text }).catch(() => undefined)}
                className="min-h-12 rounded-full px-5 text-[15px] font-semibold"
                style={{ background: 'var(--field)', color: 'var(--ink)' }}
              >
                送る
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void copy()}
              className="btn-primary min-h-12 flex-1 rounded-full text-[17px] font-semibold"
            >
              {state === 'copied' ? 'コピーしました' : 'コピー'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
