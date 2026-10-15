import { formatEstimate, formatEstimateRange } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';
import type { CategoryLine } from '@/features/category/model';
import type { CumulativeChart } from '@/features/category/pace';

const card = 'glass rounded-[28px] px-5 py-5';
const cardStyle = { background: 'var(--surface)', boxShadow: 'var(--card-shadow)' } as const;

/** 2026-11-05 → 11月5日 */
function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/**
 * カテゴリの着地(デザインの「カテゴリの詳細」):期間の終わりの見込みを大きく、目標と比べたバッジ、
 * 使った額の棒・80%の帯・中央の点・目標の目盛り、その下に80%の幅。数字は累計グラフと同じ予測。
 */
export function CategoryLandingCard({
  cumulative,
  targetYen,
}: {
  cumulative: CumulativeChart;
  targetYen: number | null;
}) {
  const last = cumulative.days.at(-1);
  const now = cumulative.endIndex !== null ? cumulative.days[cumulative.endIndex] : undefined;
  if (
    !cumulative.hasForecast ||
    last === undefined ||
    last.forecastYen === null ||
    last.forecastLowYen === null ||
    last.forecastHighYen === null
  )
    return null;
  const mid = last.forecastYen;
  if (mid <= 0) return null;
  const low = last.forecastLowYen;
  const high = last.forecastHighYen;
  const spent = now?.actualYen ?? 0;
  const max = Math.max(high, targetYen ?? 0, spent, 1) * 1.08;
  const pct = (yen: number) => `${Math.min(100, Math.max(0, (yen / max) * 100))}%`;
  const state =
    targetYen === null
      ? null
      : spent > targetYen
        ? ({ label: '超えた', color: 'var(--state-over)', bg: 'var(--state-over-track)' } as const)
        : mid > targetYen
          ? ({
              label: '▲ 超えそう',
              color: 'var(--state-caution)',
              bg: 'var(--state-caution-track)',
            } as const)
          : ({ label: '予算内', color: 'var(--state-ok)', bg: 'var(--state-ok-track)' } as const);

  return (
    <section aria-label="着地の見込み" className={`${card} space-y-4`} style={cardStyle}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            {dayLabel(last.date)}の着地
          </span>
          <span
            className="tabular text-4xl leading-none font-bold tracking-[-0.03em]"
            style={{ color: 'var(--ink)' }}
          >
            {formatEstimate(mid)}
          </span>
          {targetYen !== null ? (
            <span className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
              目標 {formatYen(targetYen, { sign: 'never' })}
            </span>
          ) : null}
        </div>
        {state ? (
          <span
            className="mt-1 shrink-0 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap"
            style={{ color: state.color, background: state.bg }}
          >
            {state.label}
          </span>
        ) : null}
      </div>
      <div aria-hidden className="relative h-12">
        <span
          className="absolute inset-x-0 top-5 h-2 rounded-full"
          style={{ background: 'var(--state-none-track)' }}
        />
        <span
          className="absolute top-4 h-4 rounded-full"
          style={{
            left: pct(low),
            width: `calc(${pct(high)} - ${pct(low)})`,
            background: 'var(--state-ok-track)',
            boxShadow: 'inset 0 0 0 1px var(--state-ok)',
          }}
        />
        <span
          className="absolute top-4 h-4 rounded-full"
          style={{ width: pct(spent), background: 'var(--ink)' }}
        />
        {targetYen !== null ? (
          <>
            <span
              className="absolute top-3 h-6 w-0.5 -translate-x-1/2"
              style={{ left: pct(targetYen), background: 'var(--ink)' }}
            />
            <span
              className="absolute top-0 -translate-x-1/2 text-xs font-semibold"
              style={{ left: pct(targetYen), color: 'var(--ink)' }}
            >
              目標
            </span>
          </>
        ) : null}
        <span
          className="absolute top-4 size-4 -translate-x-1/2 rounded-full"
          style={{
            left: pct(mid),
            background: 'var(--action)',
            boxShadow: '0 0 0 3px var(--surface)',
          }}
        />
      </div>
      <p className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
        使った額 {formatYen(spent, { sign: 'never' })}
      </p>
      <p className="text-base leading-relaxed" style={{ color: 'var(--ink)' }}>
        80%の確率で <strong className="tabular">{formatEstimateRange(low, high)}</strong>{' '}
        に入ります。
      </p>
    </section>
  );
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 曜日ごとの使った額(デザインの「なぜこの見込み?」の棒)。いちばん多い曜日を濃く。 */
export function WeekdayCard({
  lines,
  genreName,
}: {
  lines: readonly CategoryLine[];
  genreName: string;
}) {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  for (const line of lines) {
    if (line.status !== 'actual' || line.amountYen >= 0) continue;
    const day = new Date(`${line.occurredOn}T00:00:00Z`).getUTCDay();
    sums[day]! += -line.amountYen;
  }
  const max = Math.max(...sums);
  if (max <= 0) return null;
  const top = sums.indexOf(max);
  const short = (yen: number) => (yen >= 1000 ? `${Math.round(yen / 100) / 10}k` : String(yen));
  return (
    <section aria-labelledby="weekday-card" className={`${card} space-y-3`} style={cardStyle}>
      <h2 id="weekday-card" className="text-base font-bold" style={{ color: 'var(--ink)' }}>
        なぜこの見込み?
      </h2>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {genreName}は{WEEKDAYS[top]}曜日にいちばん多く使っています。
      </p>
      <div
        role="img"
        aria-label={`曜日ごとの${genreName}。${WEEKDAYS.map((w, i) => `${w}曜${formatYen(sums[i]!, { sign: 'never' })}`).join('、')}`}
        className="grid h-28 grid-cols-7 items-end gap-2"
      >
        {sums.map((yen, i) => (
          <div key={WEEKDAYS[i]} className="flex flex-col items-center gap-1">
            <span
              className="tabular text-xs"
              style={{ color: i === top ? 'var(--ink)' : 'var(--ink-secondary)' }}
            >
              {short(yen)}
            </span>
            <div
              className="w-full rounded-md"
              style={{
                height: `${Math.max(2, (yen / max) * 80)}px`,
                background:
                  yen === 0
                    ? 'var(--hairline)'
                    : i === top
                      ? 'var(--action)'
                      : 'color-mix(in srgb, var(--action) 32%, var(--surface))',
              }}
            />
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-2 text-center text-xs"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {WEEKDAYS.map((w, i) => (
          <span key={w} style={i === top ? { color: 'var(--ink)', fontWeight: 700 } : undefined}>
            {w}
          </span>
        ))}
      </div>
    </section>
  );
}
