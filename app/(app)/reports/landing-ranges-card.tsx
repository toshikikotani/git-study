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
    <div className="space-y-3">
      <h2 className="px-1 pt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>
        ジャンル別
      </h2>
      <section
        aria-label={`${periodLabel}のジャンルごとの見込み`}
        className="rounded-[28px] px-5 py-2"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        {changeable.length > 0 ? (
          <>
            <p className="pt-3 text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              変えられる支出
            </p>
            <p
              className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span className="inline-flex items-center gap-1">
                <span className="size-3 rounded-full" style={{ background: 'var(--accent)' }} />
                丸は中央
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-0.5" style={{ background: 'var(--ink)' }} />
                縦線は目標
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-4 rounded-full"
                  style={{ background: 'var(--accent-track)' }}
                />
                帯は80%の範囲
              </span>
            </p>
            <ul>
              {changeable.map((row, i) => (
                <ChangeableRow key={row.genreId} row={row} first={i === 0} />
              ))}
            </ul>
          </>
        ) : null}
        {fixed.length > 0 ? (
          <details style={{ borderTop: '1px solid var(--hairline)' }}>
            <summary
              className="tabular flex min-h-12 cursor-pointer items-center justify-between gap-3 text-xs font-semibold"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span>決まった支出({fixed.length}つ)</span>
              <span style={{ color: 'var(--ink)' }}>
                {formatYen(fixedTotal, { sign: 'never' })}
              </span>
            </summary>
            <ul className="space-y-2 pb-3">
              {fixed.map((row) => (
                <FixedRow key={row.genreId} row={row} />
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <p className="px-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        帯は80%の範囲、点は中央、縦の線は目標(棒は目標の1.5倍まで)。行を押すと、なぜその見込みかを出す。
      </p>
    </div>
  );
}

function ChangeableRow({ row, first }: { row: LandingRow; first: boolean }) {
  const scaleMax =
    row.targetYen !== null && row.targetYen > 0
      ? row.targetYen * SCALE_OF_TARGET
      : Math.max(row.p90, 1) * 1.1;
  const pct = (yen: number) => `${Math.min(100, Math.max(0, (yen / scaleMax) * 100))}%`;
  const exceedText =
    row.targetYen !== null && row.exceedance !== null
      ? `目標${formatEstimate(row.targetYen, { approx: false })}を超える見込み ${formatTimesInTen(row.exceedance)}`
      : null;
  const spoken = `${row.name}、月末の見込み${formatEstimate(row.p50)}、10回中8回は${formatEstimateRange(row.p10, row.p90)}${
    exceedText ? `、${exceedText}` : ''
  }`;
  const likely = row.caution?.kind === 'likely';
  const cut =
    likely && row.cutPerWeekYen !== null && row.cutPerWeekYen > 0
      ? ` · 週1回へらすと${formatEstimate(row.cutPerWeekYen)}減`
      : '';
  return (
    <li style={first ? undefined : { borderTop: '1px solid var(--hairline)' }}>
      <details>
        <summary className="flex cursor-pointer list-none flex-col gap-3 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="min-w-0 truncate text-base font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              {row.name}
            </span>
            <span
              className="tabular shrink-0 text-sm font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              {formatEstimate(row.p50)}
              {row.targetYen !== null ? (
                <span className="font-normal" style={{ color: 'var(--ink-secondary)' }}>
                  {' '}
                  / 目標 {formatEstimate(row.targetYen, { approx: false })}
                </span>
              ) : null}
            </span>
          </div>
          <div role="img" aria-label={spoken} className="relative h-4 w-full">
            <span
              className="absolute inset-x-0 top-1 h-2 rounded-full"
              style={{ background: 'var(--plane)' }}
            />
            <span
              className="absolute top-1 h-2 rounded-full"
              style={{
                left: pct(row.p10),
                width: `calc(${pct(row.p90)} - ${pct(row.p10)})`,
                background: 'var(--accent-track)',
              }}
            />
            {row.targetYen !== null ? (
              <span
                aria-hidden
                className="absolute inset-y-0 w-0.5 -translate-x-1/2"
                style={{ left: pct(row.targetYen), background: 'var(--ink)' }}
              >
                <span className="sr-only">目標</span>
              </span>
            ) : null}
            <span
              aria-hidden
              className="absolute top-0 size-4 -translate-x-1/2 rounded-full"
              style={{
                left: pct(row.p50),
                background: 'var(--accent)',
                boxShadow: '0 0 0 3px var(--surface)',
              }}
            />
          </div>
          <p
            className="tabular text-xs"
            style={{
              color: likely ? 'var(--state-caution)' : 'var(--ink-secondary)',
              fontWeight: likely ? 600 : 400,
            }}
          >
            {row.exceedance !== null && row.targetYen !== null
              ? `${formatProbability(row.exceedance)}の確率で 目標を超えます${cut}`
              : `80%の確率で ${formatEstimateRange(row.p10, row.p90)}`}
          </p>
          {row.caution?.kind === 'over' ? <CautionLine row={row} /> : null}
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
          {row.status === 'forecast' || (row.status === 'closed' && row.p50 > row.baseYen)
            ? formatEstimate(row.p50)
            : formatYen(row.p50, { sign: 'never' })}
        </span>
      </div>
      <p className="tabular mt-1" style={{ color: 'var(--ink-secondary)' }}>
        {statusText}
        {row.targetYen !== null ? ` ・ 目標 ${formatYen(row.targetYen, { sign: 'never' })}` : ''}
      </p>
      {row.status === 'closed' && row.p50 > row.baseYen ? (
        <p className="tabular mt-1" style={{ color: 'var(--ink-secondary)' }}>
          守れたら {formatYen(row.baseYen, { sign: 'never' })}、いつもの守り方なら{' '}
          {formatEstimate(row.p50)}
        </p>
      ) : null}
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
