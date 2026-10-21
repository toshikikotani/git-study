import Link from 'next/link';
import { cache } from 'react';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { subscriptionKeyOf } from '@/domain/subscriptions';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { addDays, daysBetween, todayJst } from '@/lib/date';
import { CategoryMark } from '../category-sheet';
import { DirectRecordEditor } from '../transactions/direct-record-editor';

/** これからの支払いに出す件数と、見る先の日数。 */
const UPCOMING_COUNT = 3;
const AHEAD_DAYS = 31;

function isListed(t: LedgerTransaction): boolean {
  return !t.isTransfer && t.reviewStatus !== 'ignored' && !t.needsInput && t.amountYen !== 0;
}

function yen(amountYen: number): string {
  return `${Math.abs(amountYen).toLocaleString('ja-JP')}円`;
}

/** 今日から31日先までの記録と、固定費の判定(1回の表示で1回だけ読む)。 */
const loadHomeRecords = cache(async () => {
  const today = todayJst();
  const [loaded, fixedKeys] = await Promise.all([
    loadLedgerTransactions({ from: today, to: addDays(today, AHEAD_DAYS) }, today).catch(
      () => null,
    ),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
  ]);
  if (loaded === null) return null;
  const isFixed = (t: LedgerTransaction) =>
    fixedKeys.has(subscriptionKeyOf(t.label, t.description, t.amountYen)) ||
    (t.genreId !== null && fixedKeys.has(`genre:${t.genreId}`));
  return { today, rows: loaded.transactions.filter(isListed), isFixed };
});

/**
 * 今日の画面の「予定と固定費」(デザイン v3-1、ADR-108。名前は ADR-127 でそろえた):明日から31日先までの予定を近い順に3件。
 * 「予定と固定費をすべて見る」でその画面へ。
 */
export async function UpcomingPayments() {
  const data = await loadHomeRecords();
  if (data === null) return null;
  const { today, isFixed } = data;
  const upcoming = data.rows
    .filter((t) => t.occurredOn > today && t.amountYen < 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
    .slice(0, UPCOMING_COUNT);

  return (
    <section aria-labelledby="home-upcoming" className="flex flex-col gap-2">
      <h2
        id="home-upcoming"
        className="px-1 pt-3 text-[22px] font-bold"
        style={{ color: 'var(--ink)' }}
      >
        予定と固定費
      </h2>
      <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        {upcoming.length === 0 ? (
          <p className="px-4 py-3 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {AHEAD_DAYS}日先までの予定はありません。
          </p>
        ) : (
          <ul>
            {upcoming.map((t, i) => {
              const days = daysBetween(today, t.occurredOn);
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
                >
                  <DirectRecordEditor transaction={t}>
                    <span className="tabular flex w-11 shrink-0 flex-col items-center">
                      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {Number(t.occurredOn.slice(5, 7))}月
                      </span>
                      <span className="text-[20px] font-bold" style={{ color: 'var(--ink)' }}>
                        {Number(t.occurredOn.slice(8, 10))}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className="truncate text-[16px] font-semibold"
                        style={{ color: 'var(--ink)' }}
                      >
                        {t.label}
                      </span>
                      <span className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                        {isFixed(t) ? '固定費' : '予定'} · {t.genreName ?? '未分類'} · あと{days}日
                      </span>
                    </span>
                    <span
                      className="tabular shrink-0 text-[16px] font-semibold"
                      style={{ color: 'var(--ink)' }}
                    >
                      {yen(t.amountYen)}
                    </span>
                  </DirectRecordEditor>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/upcoming"
          className="flex min-h-12 items-center justify-between px-4 text-[15px] font-semibold"
          style={{ color: 'var(--accent)', borderTop: '1px solid var(--hairline)' }}
        >
          すべて見る
          <ChevronRightIcon />
        </Link>
      </div>
    </section>
  );
}

/** ホームの「今日の記録」(デザイン v3-1):今日の分だけ。「すべて」で明細へ。マークを押すとそのカテゴリ(⑦)。 */
export async function TodayRecords() {
  const data = await loadHomeRecords();
  if (data === null) return null;
  const { today, isFixed } = data;
  const todays = data.rows
    .filter((t) => t.occurredOn === today)
    .sort((a, b) => a.amountYen - b.amountYen);
  const items = await listReceiptItemsForTransactionIds(todays.map((r) => r.id)).catch(
    () => new Map(),
  );

  return (
    <section aria-labelledby="home-today-records" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1 pt-3">
        <h2
          id="home-today-records"
          className="text-[22px] font-bold"
          style={{ color: 'var(--ink)' }}
        >
          今日の記録
        </h2>
        <Link
          href="/spending"
          className="flex min-h-11 items-center text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          すべて
        </Link>
      </div>
      {todays.length === 0 ? (
        <p
          className="rounded-2xl px-4 py-3 text-[13px]"
          style={{ background: 'var(--surface)', color: 'var(--ink-muted)' }}
        >
          今日はまだ記録がありません。
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl" style={{ background: 'var(--surface)' }}>
          {todays.map((t, i) => {
            const genre = t.genreName ?? '未分類';
            const firstItem = (items.get(t.id) as { name: string }[] | undefined)?.[0]?.name;
            const sub = isFixed(t)
              ? `${genre} · 固定費`
              : firstItem
                ? `${genre} · ${firstItem}`
                : genre;
            const income = t.amountYen > 0;
            return (
              <li key={t.id}>
                {i > 0 ? (
                  <div className="ml-16 h-px" style={{ background: 'var(--hairline)' }} />
                ) : null}
                <div className="flex items-center gap-3 py-2 pr-4 pl-2">
                  <CategoryMark genreId={t.genreId} name={t.genreName} />
                  <DirectRecordEditor transaction={t}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className="truncate text-[16px] font-semibold"
                        style={{ color: 'var(--ink)' }}
                      >
                        {t.label}
                      </span>
                      <span className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                        {sub}
                      </span>
                    </span>
                    <span
                      className="tabular shrink-0 text-[16px] font-semibold"
                      style={{ color: income ? 'var(--income)' : 'var(--ink)' }}
                    >
                      {income ? '+' : ''}
                      {yen(t.amountYen)}
                    </span>
                  </DirectRecordEditor>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
