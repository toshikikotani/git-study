import Link from 'next/link';

import { buildUpcoming } from '@/domain/upcoming';
import { listGenres } from '@/features/genre/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { addDays, addMonths, daysBetween, monthStartJst, todayJst } from '@/lib/date';
import { CategoryFixedBanner, DetectedPayments } from './upcoming-actions';

// 予定・固定費を直したあとの反映を常に見せる。
export const dynamic = 'force-dynamic';

/** 2026-10-23 → 10月23日 */
function jaDate(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

function yen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`;
}

/**
 * これからの支払い(デザイン v3-7、ADR-108):今期の終わりまでの予定と、毎月の固定費、見つけた定期支払い。
 * カテゴリごと固定費に毎月ちがう出費が入っていたら、外すかを聞く(本人の指摘:娯楽・趣味のライブ代が
 * 固定費 81,960円 に入っていた)。
 */
export default async function UpcomingPage() {
  const today = todayJst();
  const monthFrom = monthStartJst();
  const month = { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) };
  const plan = await getCurrentPlan(today).catch(() => null);
  const until = plan && plan.periodEnd > today ? plan.periodEnd : month.to;
  const [ledger, genres, fixedKeys, detected] = await Promise.all([
    loadLedgerTransactions(
      { from: monthFrom < today ? monthFrom : today, to: until > month.to ? until : month.to },
      today,
    ).catch(() => null),
    listGenres().catch(() => []),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    loadDetectedSubscriptions().catch(() => []),
  ]);
  const categoryFixedIds = new Set(
    genres.filter((g) => g.forecastClosed || fixedKeys.has(`genre:${g.id}`)).map((g) => g.id),
  );
  const view = buildUpcoming({
    rows: (ledger?.transactions ?? []).filter(
      (t) => !t.isTransfer && t.reviewStatus !== 'ignored' && t.amountYen !== 0,
    ),
    today,
    until,
    month,
    categoryFixedIds,
    fixedKeys,
    detected,
  });
  const monthLabel = `${Number(monthFrom.slice(5, 7))}月`;

  return (
    <div className="rise flex flex-col gap-3" style={{ color: 'var(--ink)' }}>
      <Link
        href="/"
        className="-ml-1 flex min-h-11 items-center self-start text-[17px]"
        style={{ color: 'var(--accent)' }}
      >
        <span aria-hidden className="mr-1">
          ‹
        </span>
        今日
      </Link>
      <header className="flex flex-col gap-1 px-1">
        <h1 className="text-[28px] font-bold">これからの支払い</h1>
        <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
          {jaDate(until)}までの予定と、毎月の固定費
        </span>
      </header>

      <CategoryFixedBanner
        categories={view.categoryFixed
          .filter((c) => c.mixed)
          .map((c) => ({ genreId: c.genreId, genreName: c.genreName, amountYen: c.amountYen }))}
        fixedTotalYen={view.fixedTotalYen}
      />

      <h2 className="px-1 pt-3 text-[15px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        予定 · 今期
      </h2>
      <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        {view.scheduled.length === 0 ? (
          <p className="px-4 py-3 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
            {jaDate(until)}までの予定はありません。日付を先にして記録すると、ここに出ます。
          </p>
        ) : (
          view.scheduled.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-4 py-3"
              style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
            >
              <span className="tabular flex w-11 shrink-0 flex-col items-center">
                <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {Number(p.date.slice(5, 7))}月
                </span>
                <span className="text-[20px] font-bold">{Number(p.date.slice(8, 10))}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[16px] font-medium">{p.name}</span>
                <span className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                  {p.fixed ? '固定費' : '予定'} · {p.genreName ?? '未分類'} · あと
                  {daysBetween(today, p.date)}日
                </span>
              </span>
              <span className="tabular shrink-0 text-[16px] font-semibold">{yen(p.amountYen)}</span>
            </div>
          ))
        )}
      </div>

      <div
        className="tabular flex items-baseline justify-between px-1 pt-3 text-[15px] font-semibold"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span>毎月の固定費</span>
        <span>{yen(view.fixedTotalYen)}</span>
      </div>
      <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        {view.fixedItems.length === 0 && view.categoryFixed.length === 0 ? (
          <p className="px-4 py-3 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
            固定費はまだありません。記録するときに「毎月の固定費にする」をオンにすると、ここに出ます。
          </p>
        ) : null}
        {view.fixedItems.map((f, i) => (
          <div
            key={f.key}
            className="flex items-center gap-3 px-4 py-3"
            style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px] font-medium">{f.name}</span>
              <span className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {f.genreName ?? '未分類'}
              </span>
            </span>
            <span className="tabular flex shrink-0 flex-col items-end">
              <span className="text-[16px] font-semibold">{yen(f.amountYen)}</span>
              <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {f.paidOn !== null
                  ? `${monthLabel} 支払い済み`
                  : f.dueOn !== null
                    ? `${jaDate(f.dueOn)} 予定`
                    : ''}
              </span>
            </span>
          </div>
        ))}
        {view.categoryFixed.map((c, i) => (
          <div
            key={c.genreId}
            className="flex items-center gap-3 px-4 py-3"
            style={
              i > 0 || view.fixedItems.length > 0
                ? { borderTop: '1px solid var(--hairline)' }
                : undefined
            }
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px] font-medium">{c.genreName}(カテゴリごと)</span>
              <span
                className="truncate text-[13px]"
                style={{ color: c.mixed ? 'var(--state-caution)' : 'var(--ink-muted)' }}
              >
                {c.mixed ? '毎月ちがう出費が入っています' : `${monthLabel}の支払い`}
              </span>
            </span>
            <span className="tabular shrink-0 text-[16px] font-semibold">{yen(c.amountYen)}</span>
          </div>
        ))}
      </div>

      <h2 className="px-1 pt-3 text-[15px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        見つけた定期支払い
      </h2>
      <DetectedPayments
        detected={view.detected.map((d) => ({
          key: d.key,
          label: d.label,
          amountYen: d.amountYen,
          nextOn: d.nextExpectedOn,
        }))}
      />
    </div>
  );
}
