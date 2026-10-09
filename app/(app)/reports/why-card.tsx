import { formatEstimate } from '@/domain/forecast/format';
import type { Forecast } from '@/domain/forecast/types';
import { formatYen } from '@/domain/money';
import { paceReason } from '@/domain/report-insights';

/** ふだんの買い物のうち、ジャンル名で出す数(残りは「そのほか」にまとめる)。 */
const MAX_GENRES = 3;

type Line = { key: string; label: string; note?: string | undefined; yen: number };

/**
 * なぜこの見込み?(設計書 v3 3.5)。月末の見込みを「もう決まっている」と「これから使いそうな額」の
 * 2つに分けて見せる。これからの分は、ふだんの買い物(ジャンル別・1日あたり)・いつも通う店・
 * 請求・まだ記録していない分・大きめの出費に分ける。
 *
 * 中央値どうしは足し算にならないので、これからの合計は中央の見込みから出し、その内訳は
 * それぞれの平均の割合で分けた目安(forecast.breakdown)。合計は見出しの数字と必ず一致する。
 */
export function WhyCard({
  forecast,
  endLabel,
  closedGenreIds,
}: {
  forecast: Forecast;
  endLabel: string;
  closedGenreIds?: ReadonlySet<string>;
}) {
  const b = forecast.breakdown;
  if (b.totalYen <= 0) return null;
  const decided = b.actualYen + b.committedYen;
  const ahead = Math.max(0, b.totalYen - decided);
  const days = forecast.remainingDays;
  const perDay = (yen: number) => (days > 0 ? `1日 ${formatEstimate(yen / days)}` : undefined);

  const genres = b.variableByCategory.filter(
    (c) => c.yen > 0 && !closedGenreIds?.has(c.categoryId),
  );
  const shown = genres.slice(0, MAX_GENRES);
  const restYen = b.variableYen - shown.reduce((sum, c) => sum + c.yen, 0);
  const daily: Line[] = [
    ...shown.map((c) => ({
      key: `g-${c.categoryId}`,
      label: c.categoryName,
      note: perDay(c.yen),
      yen: c.yen,
    })),
    ...(restYen > 0
      ? [{ key: 'g-rest', label: 'そのほか', note: perDay(restYen), yen: restYen }]
      : []),
  ];
  const merchants = forecast.visits.merchants.map((m) => m.label).slice(0, 2);
  const bills = forecast.bills.items.map((i) => i.label).slice(0, 2);
  const others: Line[] = [
    {
      key: 'visits',
      label: 'いつも通う店',
      note: merchants.length > 0 ? `${merchants.join('・')}など` : undefined,
      yen: b.visitsYen,
    },
    {
      key: 'bills',
      label: '請求・期ごとの支払い',
      note: bills.length > 0 ? `${bills.join('・')}など` : undefined,
      yen: b.billsYen,
    },
    {
      key: 'unrecorded',
      label: 'まだ記録していない分',
      note: 'いつもの記録の遅れから',
      yen: b.unrecordedYen,
    },
    {
      key: 'special',
      label: '大きめの出費',
      note: 'ふだんより高い買い物が、これまでの頻度で起きるとして',
      yen: b.specialYen,
    },
  ].filter((l) => l.yen > 0);

  const pace = paceReason(forecast);
  const recent = forecast.pace.recentPerDayYen;
  const share = (yen: number) => `${Math.max(0, Math.min(100, (yen / b.totalYen) * 100))}%`;
  const spoken = `${endLabel}の見込み${formatEstimate(b.totalYen)}。もう決まっている${formatYen(decided, { sign: 'never' })}、これから使いそうな額${formatEstimate(ahead)}。`;

  return (
    <section
      aria-label="なぜこの見込み?"
      className="glass rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        なぜこの見込み?
      </p>
      <p className="tabular mt-2 text-sm" style={{ color: 'var(--ink)' }}>
        {endLabel}の見込み{' '}
        <span className="text-lg font-semibold">{formatEstimate(b.totalYen)}</span> の内訳
      </p>

      {/* 決まっている額(濃い)と、これから(薄い)の2色の棒。 */}
      <div
        role="img"
        aria-label={spoken}
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--hairline)' }}
      >
        <span style={{ width: share(decided), background: 'var(--ink-muted)', opacity: 0.75 }} />
        <span style={{ width: share(ahead), background: 'var(--income)', opacity: 0.45 }} />
      </div>

      <Group
        title="もう決まっている"
        total={formatYen(decided, { sign: 'never' })}
        swatch="decided"
        lines={[
          { key: 'actual', label: '使った額', yen: b.actualYen },
          { key: 'committed', label: '予定・固定費', yen: b.committedYen },
        ].filter((l) => l.key === 'actual' || l.yen > 0)}
        fact
      />

      <Group
        title="これから使いそうな額"
        total={formatEstimate(ahead)}
        note={days > 0 ? `残り${days}日・${perDay(ahead)}` : undefined}
        swatch="ahead"
      >
        {daily.length > 0 ? (
          <div className="mt-2">
            <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              ふだんの買い物 {formatEstimate(b.variableYen)}
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              外食や食料品を、いつものペースで続けたとき
            </p>
            <Lines lines={daily} max={b.variableYen} indent />
          </div>
        ) : null}
        {others.length > 0 ? <Lines lines={others} /> : null}
      </Group>

      {pace && recent !== null ? (
        <p
          className="mt-4 rounded-2xl px-3 py-2 text-xs leading-relaxed"
          style={{
            background: pace.tone === 'caution' ? 'var(--attention-track)' : 'var(--surface)',
            color: 'var(--ink)',
          }}
        >
          直近2週間は1日 {formatEstimate(recent)}、この先は1日{' '}
          {formatEstimate(forecast.pace.perDayYen ?? 0)}で見ています。
          {pace.tone === 'caution'
            ? '直近が高いのが、大きな買い物が続いただけならこのくらいに落ち着きます。ふだんの買い物が増えているなら、もっと多くなります。'
            : ''}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        「これから」の内訳は目安です(合計は{endLabel}の見込みと同じになるように分けています)。
      </p>
    </section>
  );
}

function Group({
  title,
  total,
  note,
  swatch,
  lines,
  fact = false,
  children,
}: {
  title: string;
  total: string;
  note?: string | undefined;
  swatch: 'decided' | 'ahead';
  lines?: Line[];
  fact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          <span
            aria-hidden
            className="mr-2 inline-block size-3 rounded-full align-middle"
            style={{
              background: swatch === 'decided' ? 'var(--ink-muted)' : 'var(--income)',
              opacity: swatch === 'decided' ? 0.75 : 0.45,
            }}
          />
          {title}
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {total}
        </p>
      </div>
      {note ? (
        <p className="tabular mt-1 text-right text-xs" style={{ color: 'var(--ink-muted)' }}>
          {note}
        </p>
      ) : null}
      {lines ? <Lines lines={lines} fact={fact} /> : null}
      {children}
    </div>
  );
}

function Lines({
  lines,
  max,
  indent = false,
  fact = false,
}: {
  lines: Line[];
  /** あれば、各行にこの額に対する割合の細い棒を付ける。 */
  max?: number;
  indent?: boolean;
  fact?: boolean;
}) {
  return (
    <ul className={`mt-2 space-y-2 ${indent ? 'pl-3' : ''}`}>
      {lines.map((l) => (
        <li key={l.key} className="text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0" style={{ color: 'var(--ink-secondary)' }}>
              {l.label}
              {l.note ? (
                <span className="ml-2" style={{ color: 'var(--ink-muted)' }}>
                  {l.note}
                </span>
              ) : null}
            </span>
            <span className="tabular shrink-0" style={{ color: 'var(--ink)' }}>
              {fact ? formatYen(l.yen, { sign: 'never' }) : formatEstimate(l.yen)}
            </span>
          </div>
          {max ? (
            <div
              aria-hidden
              className="mt-1 h-1 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--hairline)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, (l.yen / max) * 100))}%`,
                  background: 'var(--income)',
                  opacity: 0.45,
                }}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
