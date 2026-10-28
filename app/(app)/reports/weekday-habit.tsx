import { formatCompactYen, formatYen } from '@/domain/money';
import { weekdayAverage, type WeekdayHabitData } from './weekday-habit-data';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
/**
 * 濃さの段階ごとの強調の塗り(--action)の割合(0 は記録なし)。中くらいの濃さは白い文字にも黒い文字にも
 * 読めない(約1.2:1 だった)ので、淡い3段(文字は本文の色)と、塗りきり1段(文字は塗りの上の色)にする。
 * どのテーマでも 4.5:1 以上(tests/color-presets.test.ts、ADR-131)。
 */
export const HABIT_MIX = [0, 12, 22, 34, 100] as const;
const TOP = HABIT_MIX.length - 1;

/** 合計・平均のマス:1万円未満は円まで(1,596)、1万円からは万(1.2万)。マスの幅(約32px)に収まる。 */
function summaryYen(yen: number): string {
  return yen < 10_000 ? Math.round(yen).toLocaleString('ja-JP') : formatCompactYen(yen);
}

/** 「各4日」「4〜5日」(今期のこれまでの、それぞれの曜日の日数。まだ来ていない曜日は数えない)。 */
function countsLabel(counts: readonly number[]): string {
  const came = counts.filter((n) => n > 0);
  const lo = Math.min(...came);
  const hi = Math.max(...came);
  return lo === hi ? `各${lo}日` : `${lo}〜${hi}日`;
}

/**
 * 曜日のくせ(デザイン仕様書の「分析 › 目標」、ADR-091):今期のカテゴリ × 曜日の支出を濃さで並べ、
 * いちばん多い曜日と、その曜日に多いカテゴリを1行で言う。表の下に、曜日ごとの合計(すべてのカテゴリ)と
 * 1日平均(その曜日1日あたり)の2行を足した(本人「曜日ごとに合計と平均を知りたい」、ADR-137)。
 */
export function WeekdayHabit({ data }: { data: WeekdayHabitData }) {
  const { rows, totals, dayCounts } = data;
  if (rows.length === 0) return null;

  const max = Math.max(1, ...rows.flatMap((g) => g.days));
  const level = (yen: number) =>
    yen <= 0 ? 0 : Math.min(TOP, Math.max(1, Math.ceil((yen / max) * TOP)));
  const averages = WEEKDAYS.map((_, i) => weekdayAverage(data, i));
  // いちばん多い曜日は1日平均で決める(期間の中で回数の多い曜日が、合計だけで多く見えないように)。
  const topDay = averages.reduce<number>(
    (best, avg, i) => ((avg ?? -1) > (averages[best] ?? -1) ? i : best),
    0,
  );
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
      className="flex flex-col rounded-2xl px-4 pt-5 pb-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <h3 id="weekday-habit" className="text-[17px] font-semibold">
        曜日のくせ
      </h3>
      {sentence ? (
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
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
                  className={`flex h-8 items-center justify-center rounded-lg ${lv === TOP ? 'font-bold' : ''}`}
                  style={{
                    background:
                      lv === 0
                        ? 'var(--note)'
                        : `color-mix(in srgb, var(--action) ${HABIT_MIX[lv]}%, var(--note))`,
                    color: lv === TOP ? 'var(--on-action)' : 'var(--ink)',
                  }}
                >
                  {yen > 0 ? formatCompactYen(yen) : ''}
                </span>
              );
            })}
          </div>
        ))}
        <div
          aria-hidden
          className="col-span-8 my-1 h-px"
          style={{ background: 'var(--hairline)' }}
        />
        <SummaryRow
          label="合計"
          values={totals.map((yen, i) => (dayCounts[i]! > 0 ? yen : null))}
          topDay={topDay}
          describe={(w, yen) => `${w}曜の合計 ${formatYen(yen, { sign: 'never' })}`}
        />
        <SummaryRow
          label="1日平均"
          values={averages}
          topDay={topDay}
          describe={(w, yen) => `${w}曜の1日平均 ${formatYen(yen, { sign: 'never' })}`}
        />
      </div>
      <div
        aria-hidden
        className="mt-3 flex items-center justify-end gap-1 text-[11px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        少
        {HABIT_MIX.slice(1).map((m) => (
          <span
            key={m}
            className="size-3 rounded-sm"
            style={{ background: `color-mix(in srgb, var(--action) ${m}%, var(--note))` }}
          />
        ))}
        多
      </div>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {`合計はすべてのカテゴリ。1日平均は、その曜日1日あたり(今期のこれまで${countsLabel(dayCounts)}。記録のない日も入れる)。`}
      </p>
    </section>
  );
}

/** 合計・1日平均の行。いちばん多い曜日(1日平均)は太字で、淡い面に載せる。まだ来ていない曜日は「—」。 */
function SummaryRow({
  label,
  values,
  topDay,
  describe,
}: {
  label: string;
  values: readonly (number | null)[];
  topDay: number;
  describe: (weekday: string, yen: number) => string;
}) {
  return (
    <div role="row" className="contents">
      <span
        role="rowheader"
        className="truncate text-left text-[13px] font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        {label}
      </span>
      {values.map((yen, i) => (
        <span
          key={WEEKDAYS[i]}
          role="cell"
          aria-label={
            yen === null ? `${WEEKDAYS[i]}曜 まだありません` : describe(WEEKDAYS[i]!, yen)
          }
          className={`flex h-8 items-center justify-center rounded-lg ${i === topDay ? 'font-bold' : 'font-medium'}`}
          style={{
            background: i === topDay ? 'var(--accent-track)' : 'transparent',
            color: yen === null ? 'var(--ink-muted)' : 'var(--ink)',
          }}
        >
          {yen === null ? '—' : summaryYen(yen)}
        </span>
      ))}
    </div>
  );
}
