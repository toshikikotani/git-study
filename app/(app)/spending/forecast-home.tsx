import Link from 'next/link';
import type { Route } from 'next';

import {
  approxRange,
  approxSignedYen,
  approxYen,
  outOfTen,
  probabilityWord,
  round100,
} from '@/domain/forecast/format';
import type { MonthForecastView } from '@/features/forecast/store';
import { hasIncome } from '@/domain/summary-rules';
import { BandBar, ForecastBadge, learningNote, Pill, targetGapLabel, TenDots } from './forecast/parts';

/**
 * 概要の結果予想(M6、本人のリデザイン「今日・月末・次の一手」)。
 * 予測は domain/forecast(確率的な予測エンジン)の結果だけを使う。旧来の
 * 「このペースが続くと」の直線の延長は使わない(置き換え)。
 */
export function ForecastHome({ view }: { view: MonthForecastView }) {
  const { forecast, budgetYen, monthLabel } = view;
  const landing = forecast.total;
  const note = learningNote(forecast);
  const prob = forecast.probWithinBudget;

  return (
    <div className="space-y-3">
      {budgetYen !== null && forecast.safeDailyAllowance !== null ? (
        <section
          aria-label="今日あと使える額"
          className="rounded-2xl p-5"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">今日 あと使える</span>
            <ForecastBadge forecast={forecast} onDark />
          </div>
          <p className="tabular mt-2 text-4xl font-semibold leading-tight">
            {round100(Math.max(0, forecast.safeDailyAllowance)).toLocaleString('ja-JP')}
            <span className="text-xl">円</span>
          </p>
          <div
            className="mt-3 border-t pt-3"
            style={{ borderColor: 'color-mix(in srgb, var(--on-accent) 25%, transparent)' }}
          >
            <p className="text-xs">
              毎日この額までなら、{monthLabel}末に予算 {approxYen(budgetYen, { approx: false })}
              に収まる
            </p>
            <div className="mt-2 flex items-center gap-3">
              <TenDots filled={forecast.safeDailyAllowance > 0 ? 8 : outOfTen(prob ?? 0)} onDark />
              <span className="text-sm font-semibold">
                10回中{forecast.safeDailyAllowance > 0 ? 8 : outOfTen(prob ?? 0)}回
              </span>
            </div>
            {note ? <p className="mt-2 text-xs">{note}</p> : null}
          </div>
        </section>
      ) : null}

      <LandingCard view={view} />

      {budgetYen !== null && prob !== null ? (
        <section
          aria-label="予算に収まる見込み"
          className="rounded-2xl p-5"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              予算 {approxYen(budgetYen, { approx: false })}に収まる
            </h2>
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              10回中 <span className="text-xl">{outOfTen(prob)}</span>回
            </span>
          </div>
          <div className="mt-3 flex">
            <TenDots filled={outOfTen(prob)} size="lg" />
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {probabilityWord(prob).word}
            {forecast.status === 'learning' ? '(目安)' : ''}。このままだと{monthLabel}末は
            {approxYen(landing.p50)}。
            {forecast.expectedOvershoot > 0
              ? `超えるときは、平均で${approxYen(forecast.expectedOvershoot)}超える。`
              : ''}
          </p>
          {forecast.drivers[0] && prob < 0.95 ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
              超えるとしたら、原因の{Math.max(1, outOfTen(forecast.drivers[0].shareOfRisk))}割は
              {forecast.drivers[0].categoryName}
            </p>
          ) : null}
        </section>
      ) : null}

      {view.actions[0] ? <NextStep view={view} /> : null}

      <CategoryRows view={view} />

      <CommittedCard view={view} />
    </div>
  );
}

function LandingCard({ view }: { view: MonthForecastView }) {
  const { forecast, incomeYen, monthLabel } = view;
  const landing = forecast.total;
  const withIncome = hasIncome(incomeYen);
  // 収入があるときは「収支」、無いときは「支出」の見込みを出す。
  const mid = withIncome ? incomeYen - landing.p50 : landing.p50;
  const low = withIncome ? incomeYen - landing.p90 : landing.p10;
  const high = withIncome ? incomeYen - landing.p10 : landing.p90;
  const span = Math.max(1, high - low);
  const pos = (v: number) => `${((v - low) / span) * 80 + 10}%`;
  return (
    <section
      aria-label={withIncome ? '月末の収支の見込み' : '月末の支出の見込み'}
      className="rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {monthLabel}末の{withIncome ? '収支' : '支出'}の見込み
        </h2>
        {view.budgetYen === null ? <ForecastBadge forecast={forecast} /> : null}
      </div>
      <p
        className="tabular mt-2 text-3xl font-semibold"
        style={{ color: withIncome && mid >= 0 ? 'var(--income)' : 'var(--ink)' }}
      >
        {withIncome ? approxSignedYen(mid) : approxYen(mid)}
      </p>
      <div aria-hidden className="relative mt-3 h-4">
        <div
          className="absolute inset-x-0 h-1 rounded-full"
          style={{ background: 'var(--plane)', top: 6 }}
        />
        <div
          className="absolute top-1 h-2 rounded-full"
          style={{ left: '10%', width: '80%', background: 'var(--state-ok-track)' }}
        />
        <div
          className="absolute top-0 h-4 w-4 rounded-full"
          style={{
            left: `calc(${pos(mid)} - 8px)`,
            background: withIncome ? 'var(--income)' : 'var(--ink)',
            boxShadow: '0 0 0 2px var(--surface)',
          }}
        />
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        10回中8回は {withIncome ? `${approxSignedYen(low)}〜${approxSignedYen(high)}` : approxRange(low, high)}
      </p>
      {view.budgetYen === null ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          ジャンルに予算を決めると、予算に収まる見込みと1日に使える額も出せます
        </p>
      ) : null}
      <div
        className="mt-3 flex items-center justify-between gap-2 border-t pt-2"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {withIncome
            ? `収入 ${approxYen(incomeYen, { unit: false, approx: false })} − 支出の見込み ${approxYen(landing.p50, { unit: false, approx: false })}`
            : `いま ${approxYen(view.decomposed.actualYen, { approx: false })}使った`}
        </span>
        <Link
          href="/spending/forecast"
          className="min-h-11 flex items-center text-sm font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          くわしく →
        </Link>
      </div>
    </section>
  );
}

function NextStep({ view }: { view: MonthForecastView }) {
  const top = view.actions[0]!;
  const before = top.baselineProbWithinBudget;
  const after = top.newProbWithinBudget;
  const showProb = before !== null && after !== null && outOfTen(after) > outOfTen(before);
  return (
    <section
      aria-label="次の一手"
      className="rounded-2xl p-5"
      style={{ background: 'var(--plane)' }}
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        次の一手
      </p>
      <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        {top.action.description}と
      </p>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {showProb ? (
          <>
            予算に収まる 10回中{outOfTen(before!)}回 →{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              {outOfTen(after!)}回
            </span>
          </>
        ) : (
          <>
            月末の見込み {approxYen(top.baselineP50)} →{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              {approxYen(top.newP50)}
            </span>
          </>
        )}
      </p>
      <Link
        href={`/spending/forecast/${encodeURIComponent(top.action.categoryId)}` as Route}
        className="min-h-11 mt-3 inline-flex items-center rounded-full px-4 text-sm font-semibold"
        style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
      >
        {top.action.categoryName}で試してみる →
      </Link>
    </section>
  );
}

function CategoryRows({ view }: { view: MonthForecastView }) {
  const rows = view.forecast.byCategory
    .filter((c) => c.landing.p50 > 0 || c.targetYen !== null)
    .sort(
      (a, b) =>
        (b.probOverTarget ?? -1) - (a.probOverTarget ?? -1) || b.landing.p50 - a.landing.p50,
    )
    .slice(0, 8);
  if (rows.length === 0) return null;
  const modeled = new Set(view.internal.fitted.categories.map((c) => c.categoryId));
  return (
    <section
      aria-label="変えられる支出"
      className="rounded-2xl px-5 pt-5 pb-2"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          ジャンルごとの見込み
        </h2>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          月末の見込み / 目標
        </span>
      </div>
      <ul>
        {rows.map((c) => {
          const scale = Math.max(
            c.targetYen !== null ? c.targetYen * 2 : 0,
            c.landing.p90 * 1.05,
            1,
          );
          const gap = c.targetYen !== null ? targetGapLabel(c.landing.p50, c.targetYen) : null;
          const tone =
            c.probOverTarget === null
              ? 'ok'
              : c.probOverTarget >= 0.6
                ? 'over'
                : c.probOverTarget >= 0.4
                  ? 'caution'
                  : 'ok';
          const body = (
            <>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {c.categoryName}
                </span>
                <span className="tabular text-base font-semibold">
                  {approxYen(c.landing.p50, { unit: false })}
                </span>
                {c.targetYen !== null ? (
                  <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
                    / {approxYen(c.targetYen, { unit: false, approx: false })}
                  </span>
                ) : null}
              </div>
              <div className="mt-2">
                <BandBar
                  actualYen={c.actualYen + c.scheduledYen}
                  low={c.landing.p10}
                  mid={c.landing.p50}
                  high={c.landing.p90}
                  targetYen={c.targetYen}
                  scaleYen={scale}
                  tone={tone}
                />
              </div>
              {gap ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Pill over={gap.over}>{gap.text}</Pill>
                  {c.probOverTarget !== null && c.probOverTarget >= 0.3 ? (
                    <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      10回中{outOfTen(c.probOverTarget)}回は目標を超える
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          );
          return (
            <li key={c.categoryId} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
              {modeled.has(c.categoryId) ? (
                <Link
                  href={`/spending/forecast/${encodeURIComponent(c.categoryId)}` as Route}
                  aria-label={`${c.categoryName}の見込みと、へらしたときの試算`}
                  className="min-h-11 block py-3"
                  style={{ color: 'var(--ink)' }}
                >
                  {body}
                </Link>
              ) : (
                <div className="py-3" style={{ color: 'var(--ink)' }}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CommittedCard({ view }: { view: MonthForecastView }) {
  const { committed, special } = view.decomposed;
  const committedYen = committed.scheduledYen + committed.fixedYen;
  const specialYen = special.actualYen + special.scheduledYen;
  if (committedYen === 0 && specialYen === 0 && view.forecast.special.expected < 100) return null;
  return (
    <section
      aria-label="決まった支出とときどきの支出"
      className="rounded-2xl"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <details className="px-5">
        <summary className="min-h-11 flex cursor-pointer list-none items-center gap-2 py-4">
          <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            決まった支出
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
              {committed.fixedItems.length > 0 ? `固定費 ${committed.fixedItems.length}件` : '予定'}
            </span>
          </span>
          <span className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
            確定 {approxYen(committedYen, { approx: false })}
          </span>
        </summary>
        <ul className="space-y-2 pb-4 text-sm" style={{ color: 'var(--ink)' }}>
          {committed.fixedItems.map((f) => (
            <li key={f.key} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{f.label}</span>
              <span className="tabular">
                {f.amountYen.toLocaleString('ja-JP')}円
                {f.occurrences > 1 ? ` × ${f.occurrences}回` : ''}
              </span>
            </li>
          ))}
          {committed.scheduledYen > 0 ? (
            <li className="flex justify-between gap-2">
              <span>予定の支出</span>
              <span className="tabular">{committed.scheduledYen.toLocaleString('ja-JP')}円</span>
            </li>
          ) : null}
          {committedYen === 0 ? <li>今月の残りに決まった支払いはありません</li> : null}
        </ul>
      </details>
      <div
        className="flex items-center gap-2 border-t px-5 py-3"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            ときどきの支出
            {specialYen > 0 ? (
              <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                今月 {specialYen.toLocaleString('ja-JP')}円
              </span>
            ) : null}
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            見込みとは別に数えます。残りの期間で平均 {approxYen(view.forecast.special.expected)}
          </p>
        </div>
        <Link
          href="/transactions/new"
          className="min-h-11 flex shrink-0 items-center rounded-full border px-3 text-xs font-semibold"
          style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
        >
          予定を入れる
        </Link>
      </div>
    </section>
  );
}
