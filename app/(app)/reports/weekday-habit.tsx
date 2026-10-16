'use client';

import { useMemo } from 'react';

import { formatYen } from '@/domain/money';
import { weekdayOf } from '@/lib/date';
import { useSpendingMonth } from '../spending/spending-month-provider';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
/** 出すカテゴリの数(多い順)。 */
const MAX_GENRES = 6;
/** 濃さの段階ごとの accent の割合(0 は記録なし)。 */
const MIX = [0, 12, 24, 45, 75, 100];

/** 4,400 → 4.4k、10,000 → 10k、550 → 550 */
function short(yen: number): string {
  if (yen < 1000) return String(Math.round(yen));
  const k = Math.round(yen / 100) / 10;
  return `${k >= 10 ? Math.round(k) : k}k`;
}

/**
 * 曜日のくせ(デザイン仕様書の「分析」、ADR-090):その月のカテゴリ × 曜日の支出を濃さで並べ、
 * いちばん多い曜日と、その曜日に多いカテゴリを1行で言う。
 */
export function WeekdayHabit() {
  const { transactions } = useSpendingMonth();
  const rows = useMemo(() => {
    const byGenre = new Map<string, number[]>();
    for (const t of transactions) {
      if (t.amountYen >= 0 || t.isTransfer || t.reviewStatus === 'ignored' || t.needsInput)
        continue;
      if (t.status === 'scheduled') continue;
      const name = t.genreName ?? '未分類';
      const days = byGenre.get(name) ?? [0, 0, 0, 0, 0, 0, 0];
      days[weekdayOf(t.occurredOn)]! += -t.amountYen;
      byGenre.set(name, days);
    }
    return [...byGenre.entries()]
      .map(([name, days]) => ({ name, days, total: days.reduce((a, b) => a + b, 0) }))
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_GENRES);
  }, [transactions]);
  if (rows.length === 0) return null;

  const max = Math.max(1, ...rows.flatMap((g) => g.days));
  const level = (yen: number) =>
    yen <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil((yen / max) * 5)));
  const dayTotals = WEEKDAYS.map((_, i) => rows.reduce((sum, g) => sum + g.days[i]!, 0));
  const topDay = dayTotals.indexOf(Math.max(...dayTotals));
  const topGenres = [...rows]
    .filter((g) => g.days[topDay]! > 0)
    .sort((a, b) => b.days[topDay]! - a.days[topDay]!)
    .slice(0, 2)
    .map((g) => g.name);
  const sentence =
    topGenres.length > 0 ? `${WEEKDAYS[topDay]}曜の${topGenres.join('と')}がいちばん多め。` : '';

  return (
    <section
      aria-labelledby="weekday-habit"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <h2 id="weekday-habit" className="text-[17px] font-semibold">
        曜日のくせ
      </h2>
      {sentence ? (
        <p className="mt-1 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
          {sentence}
        </p>
      ) : null}
      <div
        role="table"
        aria-label="カテゴリと曜日ごとの支出"
        className="tabular mt-4 grid grid-cols-[76px_repeat(7,minmax(0,1fr))] items-center gap-1 text-center text-[11px]"
      >
        <span role="columnheader" />
        {WEEKDAYS.map((w) => (
          <span key={w} role="columnheader" style={{ color: 'var(--ink-muted)' }}>
            {w}
          </span>
        ))}
        {rows.map((g) => (
          <div key={g.name} role="row" className="contents">
            <span
              role="rowheader"
              className="truncate text-left text-[13px]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {g.name}
            </span>
            {g.days.map((yen, i) => {
              const lv = level(yen);
              return (
                <span
                  key={WEEKDAYS[i]}
                  role="cell"
                  aria-label={`${g.name}・${WEEKDAYS[i]}曜 ${formatYen(yen, { sign: 'never' })}`}
                  className={`flex h-8 items-center justify-center rounded-lg ${lv === 5 ? 'font-bold' : ''}`}
                  style={{
                    background:
                      lv === 0
                        ? 'var(--note)'
                        : `color-mix(in srgb, var(--accent) ${MIX[lv]}%, var(--note))`,
                    color: lv >= 4 ? 'var(--on-accent)' : 'var(--ink)',
                  }}
                >
                  {yen > 0 ? short(yen) : ''}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
