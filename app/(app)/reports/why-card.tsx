import { formatEstimate } from '@/domain/forecast/format';
import type { Forecast } from '@/domain/forecast/types';
import { formatYen } from '@/domain/money';

/** ふだんの買い物のうち、カテゴリ名で出す数(残りは「そのほか」にまとめる)。 */
const MAX_GENRES = 3;

type Line = { key: string; label: string; yen: number };

/**
 * なぜ約19.0万円？(デザイン仕様書の「見通し」、ADR-090)。見込みを「もう決まっている」と
 * 「これから使いそう」の2色の棒に分け、それぞれの内訳を出す。これからの分は、ふだんの買い物
 * (カテゴリ · 1日あたり)・いつも通う店・請求・まだ記録していない分・ときどきある大きめの出費。
 *
 * 中央値どうしは足し算にならないので、これからの合計は中央の見込みから出し、その内訳は
 * それぞれの平均の割合で分けた目安(forecast.breakdown)。合計は見出しの数字と必ず一致する。
 */
export function WhyCard({
  forecast,
  closedGenreIds,
}: {
  forecast: Forecast;
  closedGenreIds?: ReadonlySet<string>;
}) {
  const b = forecast.breakdown;
  if (b.totalYen <= 0) return null;
  const decided = b.actualYen + b.committedYen;
  const ahead = Math.max(0, b.totalYen - decided);
  const days = forecast.remainingDays;
  const perDay = (yen: number) => (days > 0 ? ` · 1日 ${formatEstimate(yen / days)}` : '');

  const genres = b.variableByCategory.filter(
    (c) => c.yen > 0 && !closedGenreIds?.has(c.categoryId),
  );
  const shown = genres.slice(0, MAX_GENRES);
  const restYen = b.variableYen - shown.reduce((sum, c) => sum + c.yen, 0);
  const scheduled = Math.min(b.committedYen, forecast.committed?.scheduledYen ?? 0);
  const fixed = Math.max(0, b.committedYen - scheduled);
  const decidedLines: Line[] = [
    { key: 'actual', label: '使った額', yen: b.actualYen },
    { key: 'scheduled', label: '予定', yen: scheduled },
    { key: 'fixed', label: 'これからの固定費', yen: fixed },
  ].filter((l) => l.key === 'actual' || l.yen > 0);
  const aheadLines: Line[] = [
    ...shown.map((c) => ({
      key: `g-${c.categoryId}`,
      label: `${c.categoryName}${perDay(c.yen)}`,
      yen: c.yen,
    })),
    ...(restYen > 0 ? [{ key: 'g-rest', label: `そのほか${perDay(restYen)}`, yen: restYen }] : []),
    { key: 'visits', label: 'いつも通う店', yen: b.visitsYen },
    { key: 'bills', label: '請求・期ごとの支払い', yen: b.billsYen },
    { key: 'unrecorded', label: 'まだ記録していない分', yen: b.unrecordedYen },
    { key: 'special', label: 'ときどきある大きめの出費', yen: b.specialYen },
  ].filter((l) => l.yen > 0);

  return (
    <section
      aria-labelledby="why-card"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-2"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <h2 id="why-card" className="text-[17px] font-semibold">
        なぜ{formatEstimate(b.totalYen)}？
      </h2>
      <div
        role="img"
        aria-label={`もう決まっている${formatYen(decided, { sign: 'never' })}、これから使いそう${formatEstimate(ahead)}`}
        className="mt-4 flex h-3 overflow-hidden rounded-full"
        style={{ gap: 2 }}
      >
        <span style={{ flex: Math.max(decided, 0), background: 'var(--accent)' }} />
        <span style={{ flex: Math.max(ahead, 0), background: 'var(--future-fill)' }} />
      </div>
      <div className="mt-2 flex flex-col">
        <Head
          color="var(--accent)"
          title="もう決まっている"
          value={formatYen(decided, { sign: 'never' })}
        />
        {decidedLines.map((l) => (
          <Sub key={l.key} label={l.label} value={formatYen(l.yen, { sign: 'never' })} />
        ))}
        <div className="my-2 h-px" style={{ background: 'var(--hairline)' }} />
        <Head color="var(--future-fill)" title="これから使いそう" value={formatEstimate(ahead)} />
        {aheadLines.map((l) => (
          <Sub key={l.key} label={l.label} value={formatEstimate(l.yen)} />
        ))}
        <div className="h-2" />
      </div>
    </section>
  );
}

function Head({ color, title, value }: { color: string; title: string; value: string }) {
  return (
    <div className="tabular flex min-h-11 items-center justify-between text-[15px] font-semibold">
      <span className="flex items-center gap-2">
        <span aria-hidden className="size-3 rounded-full" style={{ background: color }} />
        {title}
      </span>
      <span>{value}</span>
    </div>
  );
}

function Sub({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="tabular flex justify-between gap-3 pb-2 pl-5 text-[14px]"
      style={{ color: 'var(--ink-muted)' }}
    >
      <span className="min-w-0">{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}
