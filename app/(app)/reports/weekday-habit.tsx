import { formatYen } from '@/domain/money';
import type { HabitRow } from './weekday-habit-data';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
/** 濃さの段階ごとの accent の割合(0 は記録なし)。 */
const MIX = [0, 12, 24, 45, 75, 100];

/** 4,400 → 4.4k、10,000 → 10k、550 → 550 */
function short(yen: number): string {
  if (yen < 1000) return String(Math.round(yen));
  const k = Math.round(yen / 100) / 10;
  return `${k >= 10 ? Math.round(k) : k}k`;
}

/**
 * 曜日のくせ(デザイン仕様書の「分析 › 目標」、ADR-091):今期のカテゴリ × 曜日の支出を濃さで並べ、
 * いちばん多い曜日と、その曜日に多いカテゴリを1行で言う。
 */
export function WeekdayHabit({ rows }: { rows: readonly HabitRow[] }) {
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
  const weekend = topDay === 0 || topDay === 6;
  const sentence =
    topGenres.length > 0
      ? `${WEEKDAYS[topDay]}曜の${topGenres.join('と')}がいちばん多め。${weekend ? '休日の使い方がいちばん効きます。' : ''}`
      : '';

  return (
    <section
      aria-labelledby="weekday-habit"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <h3 id="weekday-habit" className="text-[17px] font-semibold">
        曜日のくせ
      </h3>
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
      <div
        aria-hidden
        className="mt-3 flex items-center justify-end gap-1 text-[11px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        少
        {MIX.slice(1).map((m) => (
          <span
            key={m}
            className="size-3 rounded-sm"
            style={{ background: `color-mix(in srgb, var(--accent) ${m}%, var(--note))` }}
          />
        ))}
        多
      </div>
    </section>
  );
}
