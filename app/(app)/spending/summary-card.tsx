'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { formatSignedYen } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { Yen } from '@/components/ui/money';
import type { PaceComparison } from '@/domain/summary-rules';
import { splitDateOnly } from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';

export type ForecastInfo = {
  /** 出してよいとき(記録が7日以上)だけ値が入る。 */
  projectedTotalYen: number | null;
  totalBudgetYen: number | null;
};

/**
 * サマリー(今月使った額と前月同日比)。
 *
 * 記録が少ないときに意味のない数字を出さない(domain/summary-rules.ts):
 *   - 前月のデータが無ければ比較は出さず「記録開始からN日」
 *   - 収入が未登録なら「0円」や差額は出さず、「収入を登録」への導線にする
 *   - 記録が7日未満なら「このペースが続くと」の予測は出さない
 * 差額のマイナスは「−」(U+2212)、赤は使わない(赤は予算超過とエラーだけ)。
 *
 * 目標期間中は、この上に目標のスライド(goal)を並べ、横スワイプで月表示に切り替える。
 */
export function SummaryCard({
  pace,
  forecast,
  hasIncomeRegistered,
  goal,
}: {
  pace: PaceComparison;
  forecast: ForecastInfo;
  hasIncomeRegistered: boolean;
  /** 目標期間中のサマリー(期間・残り日数・使った額/予算・今日使える額)。 */
  goal: ReactNode | null;
}) {
  const monthPane = (
    <MonthPane pace={pace} forecast={forecast} hasIncomeRegistered={hasIncomeRegistered} />
  );
  if (goal === null) return monthPane;

  return <SwipeableSummary goal={goal} monthPane={monthPane} />;
}

/**
 * 目標と月のサマリーをスワイプで切り替える(N0)。以前は説明文
 * 「← 目標期間 ・ 月 →(スワイプで切り替え)」だけで案内していたが、
 * ジャンル内訳(genre-breakdown.tsx)の「今月 / 目標期間」と見た目が重複し、
 * かつボタンで直接切り替える手段が無かった。同じ「今月 / 目標期間」の
 * 切り替えボタンに一本化し、スワイプはそのボタンの状態と双方向に連動させる
 * (ボタンを押すと対応する面へスクロールし、スワイプで面が変わるとボタンの
 * 選択状態も追従する)。
 */
function SwipeableSummary({ goal, monthPane }: { goal: ReactNode; monthPane: ReactNode }) {
  const [active, setActive] = useState<'goal' | 'month'>('goal');
  const goalRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const goalEl = goalRef.current;
    const monthEl = monthRef.current;
    if (goalEl === null || monthEl === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio > 0.5) {
            setActive(entry.target === goalEl ? 'goal' : 'month');
          }
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(goalEl);
    observer.observe(monthEl);
    return () => observer.disconnect();
  }, []);

  function goTo(pane: 'goal' | 'month'): void {
    (pane === 'goal' ? goalRef.current : monthRef.current)?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }

  return (
    <div>
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="サマリーの表示" className="flex gap-1 text-xs">
          {(
            [
              ['month', '今月'],
              ['goal', '目標期間'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active === value}
              onClick={() => goTo(value)}
              className="min-h-11 rounded-full px-3 py-1 font-semibold"
              style={{
                background: active === value ? 'var(--accent)' : 'var(--plane)',
                color: active === value ? 'var(--on-accent)' : 'var(--ink-secondary)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="-mx-4 mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
        style={{ scrollbarWidth: 'none' }}
        role="region"
        aria-label="サマリー(横にスワイプで目標と月を切り替え)"
        tabIndex={0}
      >
        <div ref={goalRef} className="w-full shrink-0 snap-center">
          {goal}
        </div>
        <div ref={monthRef} className="w-full shrink-0 snap-center">
          {monthPane}
        </div>
      </div>
    </div>
  );
}

function MonthPane({
  pace,
  forecast,
  hasIncomeRegistered,
}: {
  pace: PaceComparison;
  forecast: ForecastInfo;
  hasIncomeRegistered: boolean;
}) {
  const { totals, isCurrentMonth, visibleMonth, loading, error } = useSpendingMonth();
  const [year, month] = splitDateOnly(visibleMonth);
  // 別の月を取りに行っているあいだは、0円ではなく読み込み中と分かるようにする。
  const waiting = !isCurrentMonth && (loading || error !== null);
  const incomeRegistered = isCurrentMonth ? hasIncomeRegistered : totals.incomeYen > 0;
  const netYen = totals.incomeYen - totals.spentYen;

  return (
    <section
      aria-label="使った額のサマリー"
      className="rounded-3xl p-6"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {isCurrentMonth ? '今月つかった' : `${year}年${month}月`}
      </p>
      {waiting && error === null ? (
        <div
          role="status"
          aria-label="読み込み中"
          className="mt-2 h-10 w-44 animate-pulse rounded-lg"
          style={{ background: 'var(--hairline)' }}
        />
      ) : (
        <p
          className="tabular mt-3 text-5xl leading-none font-semibold tracking-[-0.045em]"
          style={{ color: waiting ? 'var(--ink-muted)' : 'var(--ink)' }}
        >
          {waiting ? '—' : <Yen value={totals.spentYen} />}
        </p>
      )}
      {waiting && error !== null ? (
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {error}
        </p>
      ) : null}

      {!waiting ? (
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {totals.scheduledYen > 0
            ? `予定 ${formatYen(totals.scheduledYen)} は入っていない。`
            : '予定は入っていない。'}
          {incomeRegistered ? ` 収入との差は ${formatSignedYen(netYen)}。` : ''}
        </p>
      ) : null}
      {!waiting && !incomeRegistered ? (
        <Link
          href="/transactions/new?type=income"
          prefetch={false}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          手取りを入れる
        </Link>
      ) : null}

      {isCurrentMonth ? <PaceLine pace={pace} /> : null}
      {isCurrentMonth && forecast.projectedTotalYen !== null ? (
        <ForecastLine forecast={forecast} />
      ) : null}
    </section>
  );
}

function PaceLine({ pace }: { pace: PaceComparison }) {
  if (pace.kind === 'none') return null;
  if (pace.kind === 'since_start') {
    return (
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        記録開始から{pace.days}日。先月のデータがそろうと、同じ日との比較が出ます。
      </p>
    );
  }
  const isLess = pace.diffYen < 0;
  return (
    <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
      先月の{pace.dayOfMonth}日時点は {formatYen(pace.lastYen, { sign: 'never' })}。
      {pace.diffYen === 0 ? (
        ' 今月はちょうど同じです。'
      ) : (
        <>
          {' '}
          今月は{' '}
          <span className="tabular font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
            {formatYen(pace.diffYen, { sign: 'never' })} {isLess ? '少ない' : '多い'}
          </span>
          。
        </>
      )}
    </p>
  );
}

function ForecastLine({ forecast }: { forecast: ForecastInfo }) {
  const projected = forecast.projectedTotalYen!;
  const over = forecast.totalBudgetYen === null ? null : projected - forecast.totalBudgetYen;
  return (
    <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
      このペースが続くと月末までに{' '}
      <span className="tabular font-semibold" style={{ color: 'var(--ink)' }}>
        {formatYen(projected, { sign: 'never' })}
      </span>
      {over === null ? (
        '。'
      ) : over > 0 ? (
        <>(予算の合計より {formatYen(over, { sign: 'never' })} 多い見込み)。</>
      ) : (
        <>(予算の合計に対して {formatYen(-over, { sign: 'never' })} の余裕)。</>
      )}
    </p>
  );
}
