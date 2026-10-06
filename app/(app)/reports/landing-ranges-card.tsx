import {
  formatEstimate,
  formatEstimateRange,
  formatProbability,
  formatTimesInTen,
} from '@/domain/forecast/format';
import type { LandingRow } from '@/domain/forecast/landing-rows';
import { formatYen } from '@/domain/money';

export type { LandingRow };

/** 棒の右端(目標の150%)。目標をどの行でも同じ位置にそろえる(設計書 v3 3.3)。 */
const SCALE_OF_TARGET = 1.5;

/**
 * ジャンルごとの月末の見込み(設計書 v3 3.2・3.3)。
 * 上が「変えられる支出」(中央での超過額の大きい順)、下が「決まった支出」(1行に畳む)。
 * 目印:濃い棒=決まっている額、帯=10回中8回、点=中央、目盛り=目標。棒は目標の150%まで。
 * 行を開くと、そのジャンルの「なぜ」(使った額 → 決まっている額 → 残りの見込み)を出す。
 */
export function LandingRangesCard({
  rows,
  periodLabel,
}: {
  rows: LandingRow[];
  periodLabel: string;
}) {
  if (rows.length === 0) return null;
  const changeable = rows.filter((r) => r.group === 'changeable');
  const fixed = rows.filter((r) => r.group === 'fixed');
  const fixedTotal = fixed.reduce((sum, r) => sum + r.p50, 0);
  return (
    <section
      aria-label="ジャンルごとの月末の見込み"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {periodLabel}の見込み(ジャンル別)
      </p>
      {changeable.length > 0 ? (
        <>
          <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
            変えられる支出
          </p>
          <ul className="mt-2 space-y-2">
            {changeable.map((row) => (
              <ChangeableRow key={row.genreId} row={row} />
            ))}
          </ul>
        </>
      ) : null}
      {fixed.length > 0 ? (
        <details className="mt-4">
          <summary
            className="tabular flex min-h-11 cursor-pointer items-center justify-between gap-3 text-xs font-semibold"
            style={{ color: 'var(--ink-muted)' }}
          >
            <span>決まった支出({fixed.length}つ)</span>
            <span style={{ color: 'var(--ink)' }}>{formatYen(fixedTotal, { sign: 'never' })}</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {fixed.map((row) => (
              <FixedRow key={row.genreId} row={row} />
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        濃い棒はもう決まっている額、帯は10回中8回の範囲、点は中央、「目標」の目盛りは目標(棒は目標の1.5倍まで)。
        「このままだと」は、目標を超える見込みが10回中5回以上で、超える額の大きいジャンルに2つまで。行を押すと、なぜその見込みかを出す。
      </p>
    </section>
  );
}

function ChangeableRow({ row }: { row: LandingRow }) {
  const scaleMax =
    row.targetYen !== null && row.targetYen > 0
      ? row.targetYen * SCALE_OF_TARGET
      : Math.max(row.p90, 1) * 1.1;
  const pct = (yen: number) => `${Math.min(100, Math.max(0, (yen / scaleMax) * 100))}%`;
  const overflow = row.p90 > scaleMax;
  const exceedText =
    row.targetYen !== null && row.exceedance !== null
      ? `目標${formatEstimate(row.targetYen, { approx: false })}を超える見込み ${formatTimesInTen(row.exceedance)}`
      : null;
  const spoken = `${row.name}、月末の見込み${formatEstimate(row.p50)}、10回中8回は${formatEstimateRange(row.p10, row.p90)}${
    exceedText ? `、${exceedText}` : ''
  }`;
  return (
    <li>
      <details>
        <summary className="cursor-pointer list-none py-1">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="min-w-0 truncate text-sm font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              {row.name}
            </span>
            <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
              {formatEstimate(row.p50)}
            </span>
          </div>
          <div
            role="img"
            aria-label={spoken}
            className="relative mt-4 h-3 w-full rounded-full"
            style={{ background: 'var(--hairline)' }}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: pct(row.baseYen), background: 'var(--ink-muted)', opacity: 0.7 }}
            />
            <span
              className="absolute inset-y-0 rounded-full"
              style={{
                left: pct(row.p10),
                width: `calc(${pct(row.p90)} - ${pct(row.p10)})`,
                background: 'var(--income)',
                opacity: 0.3,
              }}
            />
            <span
              aria-hidden
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: pct(row.p50),
                background: 'var(--income)',
                boxShadow: '0 0 0 2px var(--surface-raised)',
              }}
            />
            {row.targetYen !== null ? (
              <span
                aria-hidden
                className="absolute -inset-y-1 w-0.5"
                style={{ left: pct(row.targetYen), background: 'var(--ink)' }}
              >
                <span
                  className="absolute -top-4 left-1/2 -translate-x-1/2 text-xs leading-none whitespace-nowrap"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  目標
                </span>
              </span>
            ) : null}
            {overflow ? (
              <span
                aria-hidden
                className="absolute top-1/2 right-0 -translate-y-1/2 text-xs leading-none"
                style={{ color: 'var(--ink-secondary)' }}
              >
                ›
              </span>
            ) : null}
          </div>
          <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {formatEstimate(row.p50)}({formatEstimateRange(row.p10, row.p90)})
            {exceedText ? `・${exceedText}` : ''}
            {row.exceedance !== null && row.targetYen !== null ? (
              <span style={{ color: 'var(--ink-muted)' }}>
                {' '}
                ({formatProbability(row.exceedance)})
              </span>
            ) : null}
          </p>
          {row.caution ? <CautionLine row={row} /> : null}
        </summary>
        <GenreWhy row={row} />
      </details>
    </li>
  );
}

/** 注意(設計書 v3 3.2)。黄色1段階。赤は、決まっている額だけで目標を超えたときだけ。形と文字も付ける。 */
function CautionLine({ row }: { row: LandingRow }) {
  const caution = row.caution!;
  const over = caution.kind === 'over';
  return (
    <div className="mt-1 text-xs leading-relaxed">
      <p
        className="font-semibold"
        style={{ color: over ? 'var(--state-over)' : 'var(--state-caution)' }}
      >
        <span aria-hidden>{over ? '● ' : '▲ '}</span>
        {over
          ? `決まっている額だけで、目標を${formatYen(caution.overshootYen, { sign: 'never' })}超えています`
          : `このままだと ${formatEstimate(caution.overshootYen)}オーバー(${formatTimesInTen(caution.probability)})`}
      </p>
      {!over && row.cutPerWeekYen !== null && row.cutPerWeekYen > 0 ? (
        <p style={{ color: 'var(--ink-secondary)' }}>
          週1回減らすと、{formatEstimate(row.cutPerWeekYen)}少なくなる見込み。
        </p>
      ) : null}
    </div>
  );
}

/** ジャンルの「なぜ」:使った額(と予定・固定費)→ 残りの見込み → 月末。 */
function GenreWhy({ row }: { row: LandingRow }) {
  const remaining = Math.max(0, row.p50 - row.baseYen);
  return (
    <dl
      className="tabular mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-2xl px-3 py-2 text-xs"
      style={{ background: 'var(--surface)', color: 'var(--ink-secondary)' }}
    >
      <dt>使った額と、決まっている予定</dt>
      <dd className="text-right" style={{ color: 'var(--ink)' }}>
        {formatYen(row.baseYen, { sign: 'never' })}
      </dd>
      <dt>この先の見込み(中央)</dt>
      <dd className="text-right" style={{ color: 'var(--ink)' }}>
        {formatEstimate(remaining)}
      </dd>
      <dt>月末の見込み</dt>
      <dd className="text-right font-semibold" style={{ color: 'var(--ink)' }}>
        {formatEstimate(row.p50)}
      </dd>
      {row.excludedYen > 0 ? (
        <dd className="col-span-2" style={{ color: 'var(--ink-muted)' }}>
          うち {formatYen(row.excludedYen, { sign: 'never' })} は目標の対象外(特別費)
        </dd>
      ) : null}
      <dd className="col-span-2" style={{ color: 'var(--ink-muted)' }}>
        {row.type === 'lumpy'
          ? 'まとめて払うことの多いジャンルなので、「このままだと」は出していない。'
          : 'この先の見込みは、曜日・給料日・今月のペースから出している。'}
      </dd>
    </dl>
  );
}

function FixedRow({ row }: { row: LandingRow }) {
  const statusText =
    row.status === 'closed'
      ? '予測を止めています'
      : row.status === 'settled'
        ? '確定(この先の見込みなし)'
        : '決まった支払い';
  return (
    <li className="text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-semibold" style={{ color: 'var(--ink)' }}>
          {row.name}
        </span>
        <span className="tabular shrink-0" style={{ color: 'var(--ink)' }}>
          {row.status === 'forecast'
            ? formatEstimate(row.p50)
            : formatYen(row.p50, { sign: 'never' })}
        </span>
      </div>
      <p className="tabular mt-1" style={{ color: 'var(--ink-secondary)' }}>
        {statusText}
        {row.targetYen !== null ? ` ・ 目標 ${formatYen(row.targetYen, { sign: 'never' })}` : ''}
      </p>
      {row.caution ? (
        <p className="mt-1 font-semibold" style={{ color: 'var(--state-over)' }}>
          <span aria-hidden>● </span>
          決まっている額だけで、目標を{formatYen(row.caution.overshootYen, { sign: 'never' })}
          超えています
        </p>
      ) : null}
      {row.excludedYen > 0 ? (
        <p className="tabular mt-1" style={{ color: 'var(--ink-muted)' }}>
          うち {formatYen(row.excludedYen, { sign: 'never' })} は目標の対象外(特別費)
        </p>
      ) : null}
    </li>
  );
}
