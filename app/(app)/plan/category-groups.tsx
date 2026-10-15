import type { Route } from 'next';
import Link from 'next/link';

import { formatEstimate, formatEstimateRange } from '@/domain/forecast/format';
import { groupLandingRows, type LandingRow } from '@/domain/forecast/landing-rows';
import { formatYen } from '@/domain/money';
import { categoryHref } from '@/lib/category-nav';

/**
 * 予算の画面のカテゴリ一覧:超えた → 超えそう → 予算内(畳む)→ 予算なし(畳む)。
 * 各行は「見込み / 予算」、使った額の棒・80%の帯・中央の点・予算の目盛り、その下に使った額と80%の幅。
 * 行を押すと、そのカテゴリの詳細(目標期間の見込みと「もし」)へ。
 */
export function BudgetCategoryGroups({
  rows,
  monthKey,
}: {
  rows: readonly LandingRow[];
  monthKey: string;
}) {
  if (rows.length === 0) return null;
  const groups = groupLandingRows(rows);
  const scaleMax =
    Math.max(...rows.map((r) => Math.max(r.p90, r.targetYen ?? 0, r.baseYen)), 1) * 1.05;
  return (
    <div className="space-y-3">
      <h2 className="px-1 pt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>
        カテゴリ
      </h2>
      <section
        aria-label="カテゴリごとの見込み"
        className="glass rounded-[28px] px-5 py-2"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <Group
          label="超えた"
          tone="over"
          rows={groups.over}
          monthKey={monthKey}
          scaleMax={scaleMax}
        />
        <Group
          label="▲ 超えそう"
          tone="caution"
          rows={groups.likely}
          monthKey={monthKey}
          scaleMax={scaleMax}
        />
        <Folded label="予算内" rows={groups.within} monthKey={monthKey} scaleMax={scaleMax} />
        <Folded label="予算なし" rows={groups.noBudget} monthKey={monthKey} scaleMax={scaleMax} />
      </section>
      <p className="px-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        濃い棒は使った額、帯は80%の確率で入る幅、丸は中央、縦線は予算です。
      </p>
    </div>
  );
}

function GroupHeading({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'over' | 'caution' | 'plain';
}) {
  const color =
    tone === 'over'
      ? 'var(--state-over)'
      : tone === 'caution'
        ? 'var(--state-caution)'
        : 'var(--ink-secondary)';
  return (
    <span className="flex items-center justify-between gap-3 text-xs font-semibold">
      <span style={{ color }}>{label}</span>
      <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
        {count}
      </span>
    </span>
  );
}

function Group({
  label,
  tone,
  rows,
  monthKey,
  scaleMax,
}: {
  label: string;
  tone: 'over' | 'caution';
  rows: readonly LandingRow[];
  monthKey: string;
  scaleMax: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="pt-3">
      <GroupHeading label={label} count={rows.length} tone={tone} />
      <ul>
        {rows.map((row) => (
          <CategoryRow key={row.genreId} row={row} monthKey={monthKey} scaleMax={scaleMax} />
        ))}
      </ul>
    </div>
  );
}

function Folded({
  label,
  rows,
  monthKey,
  scaleMax,
}: {
  label: string;
  rows: readonly LandingRow[];
  monthKey: string;
  scaleMax: number;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="pt-3" style={{ borderTop: '1px solid var(--hairline)' }}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center gap-1">
        <GroupHeading label={label} count={rows.length} tone="plain" />
        <span className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate" style={{ color: 'var(--ink)' }}>
            {rows.map((r) => r.name).join('、')}
          </span>
          <span className="shrink-0 font-semibold" style={{ color: 'var(--accent)' }}>
            表示
          </span>
        </span>
      </summary>
      <ul className="pb-2">
        {rows.map((row) => (
          <CategoryRow key={row.genreId} row={row} monthKey={monthKey} scaleMax={scaleMax} />
        ))}
      </ul>
    </details>
  );
}

function CategoryRow({
  row,
  monthKey,
  scaleMax,
}: {
  row: LandingRow;
  monthKey: string;
  scaleMax: number;
}) {
  const pct = (yen: number) => `${Math.min(100, Math.max(0, (yen / scaleMax) * 100))}%`;
  const target = row.targetYen;
  const overYen = target !== null ? row.baseYen - target : 0;
  const caption =
    row.status === 'closed'
      ? `使った額 ${formatYen(row.baseYen, { sign: 'never' })} · 予測を止めています`
      : row.status === 'settled'
        ? `使った額 ${formatYen(row.baseYen, { sign: 'never' })} · 確定(この先の見込みなし)`
        : overYen > 0 && row.p90 <= row.baseYen
          ? `${formatYen(overYen, { sign: 'never' })} 超えています · 単発の出費が多いため見込みは出していません`
          : `使った額 ${formatYen(row.baseYen, { sign: 'never' })} · 80%の確率で ${formatEstimateRange(row.p10, row.p90)}`;
  const spoken = `${row.name}、見込み${formatEstimate(row.p50)}${
    target !== null ? `、予算${formatYen(target, { sign: 'never' })}` : ''
  }。${caption}`;
  const href =
    row.name === '未分類' ? '/spending/category/none' : categoryHref(row.genreId, monthKey);
  return (
    <li style={{ borderTop: '1px solid var(--hairline)' }}>
      <Link
        href={href as Route}
        aria-label={`${spoken}。タップして詳細を開く`}
        className="flex min-h-11 flex-col gap-2 py-3"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span
            className="min-w-0 truncate text-base font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            {row.name}
          </span>
          <span className="tabular shrink-0 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {formatEstimate(row.p50)}
            {target !== null ? (
              <span className="font-normal" style={{ color: 'var(--ink-secondary)' }}>
                {' '}
                / {formatYen(target, { sign: 'never' })}
              </span>
            ) : null}
          </span>
        </span>
        <span aria-hidden className="relative block h-4 w-full">
          <span
            className="absolute inset-x-0 top-1 h-2 rounded-full"
            style={{ background: 'var(--state-none-track)' }}
          />
          {row.status === 'forecast' ? (
            <span
              className="absolute top-1 h-2 rounded-full"
              style={{
                left: pct(row.p10),
                width: `calc(${pct(row.p90)} - ${pct(row.p10)})`,
                background: 'var(--state-ok-track)',
                boxShadow: 'inset 0 0 0 1px var(--state-ok)',
              }}
            />
          ) : null}
          <span
            className="absolute top-1 h-2 rounded-full"
            style={{ width: pct(row.baseYen), background: 'var(--ink)' }}
          />
          {target !== null ? (
            <span
              className="absolute inset-y-0 w-0.5 -translate-x-1/2"
              style={{ left: pct(target), background: 'var(--ink)' }}
            />
          ) : null}
          {row.status === 'forecast' ? (
            <span
              className="absolute top-0 size-4 -translate-x-1/2 rounded-full"
              style={{
                left: pct(row.p50),
                background: 'var(--action)',
                boxShadow: '0 0 0 2px var(--surface)',
              }}
            />
          ) : null}
        </span>
        <span className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {caption}
        </span>
      </Link>
    </li>
  );
}
