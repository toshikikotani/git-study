import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  countNeedsInputCaptures,
  countPendingReview,
  countReadyCaptures,
} from '@/features/home/pending';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { listMerchantNameReviewGroups } from '@/features/transactions/merchant-name-store';
import {
  CALENDAR_OPEN_COOKIE,
  CALENDAR_VIEW_COOKIE,
  parseCalendarOpen,
  parseCalendarView,
} from '@/lib/calendar-view';
import { UnsavedReceiptsRow } from '../_home/today-todo';
import { AttentionCard } from './attention-card';
import { LedgerList, LedgerSearch } from './ledger-list';
import { loadSpendingMonthData } from './month-data';
import { MonthCopy } from './month-copy';
import { MonthSummary } from './month-summary';
import { PeriodSwitcher } from './period-switcher';
import { SpendingMonthProvider } from './spending-month-provider';
import styles from './spending.module.css';

/**
 * 明細(デザイン仕様書の「明細」、ADR-090)。上から次の順に並べる:
 *   1. 見出しと月の切り替え(‹ 10月 ›)
 *   2. 支出・収入・差額と、この月の支出を文字でコピー(ADR-134)
 *   3. 検索・絞り込み・カレンダー(既定で出す。出す / 隠す と 週 ↔ 月 は覚えておく、ADR-093/116/121)
 *   4. 保存前のレシート N件(あるときだけ、ADR-133)と、確認が必要なものをまとめたカード(あるときだけ)
 *   5. これからの予定1行 → 日付ごとの明細(固定費も払った日に含める)
 * カテゴリ・回数と1回の金額・1年の流れは「分析」へ移した。
 *
 * どの数字も domain/ledger.ts の集計関数の値(features/spending/views.ts 経由)で、
 * 同じ期間なら全部の合計が一致する。ADR-061 参照。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage({
  searchParams,
}: {
  searchParams?: Promise<{ review?: string }>;
}) {
  const query = await searchParams;
  // 古いリンクの受け皿:入力待ち・カテゴリの確認は「確認が必要」の画面にまとめた(ADR-127)。
  if (query?.review === 'input' || query?.review === 'category') redirect('/spending/review');
  const [
    data,
    duplicates,
    fixedKeys,
    jar,
    pendingInputCount,
    pendingCategoryCount,
    merchantNames,
    unsavedCount,
  ] = await Promise.all([
    loadSpendingMonthData(),
    listDuplicateCandidates(),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    cookies(),
    countNeedsInputCaptures(),
    countPendingReview(),
    listMerchantNameReviewGroups().then(
      (groups) => ({ groups, error: null }),
      () => ({ groups: [], error: '店名の確認を読み込めませんでした。' }),
    ),
    countReadyCaptures(),
  ]);
  const today = data.ledger.period.to;
  const plan = await getCurrentPlan(today).catch(() => null);

  return (
    <div className={`hm-page ${styles.page}`}>
      <SpendingMonthProvider
        today={today}
        currentMonthStart={data.ledger.period.from}
        currentTransactions={data.transactions}
        currentGenreBreakdown={data.ledger.genreBreakdown}
        currentTotals={data.ledger.totals}
        genres={data.genres}
        accounts={data.accounts}
        captures={data.captures}
      >
        <PeriodSwitcher />
        <div className={styles.monthRegion}>
          <MonthSummary />
          <MonthCopy />
        </div>
        <LedgerSearch
          initialCalendarView={parseCalendarView(jar.get(CALENDAR_VIEW_COOKIE)?.value)}
          initialCalendarOpen={parseCalendarOpen(jar.get(CALENDAR_OPEN_COOKIE)?.value)}
        />
        {unsavedCount > 0 ? (
          <div
            className="overflow-hidden rounded-2xl"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          >
            <UnsavedReceiptsRow count={unsavedCount} />
          </div>
        ) : null}
        <AttentionCard
          hasGoal={plan !== null}
          duplicateCount={duplicates.length}
          pendingInputCount={pendingInputCount}
          pendingCategoryCount={pendingCategoryCount}
          merchantNameGroups={merchantNames.groups}
          merchantNameError={merchantNames.error}
        />
        <LedgerList
          goalRange={null}
          duplicateCount={duplicates.length}
          fixedKeys={[...fixedKeys]}
        />
      </SpendingMonthProvider>
    </div>
  );
}
