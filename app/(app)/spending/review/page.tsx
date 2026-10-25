import { BackHeader } from '@/components/ui/back-header';
import { listPendingReviewRecords } from '@/features/home/pending';
import { listOpenCaptures, listReadyReceipts } from '@/features/receipt-captures/store';
import { getAppSettings } from '@/features/settings/store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { listDuplicateReview } from '@/features/transactions/duplicates-store';
import { listMerchantNameReviewGroups } from '@/features/transactions/merchant-name-store';
import { todayJst } from '@/lib/date';
import { loadSpendingMonthData } from '../month-data';
import { countTodayCheck } from '../../_home/today-check-card';
import { ReviewHub } from '../review-hub';
import { TodayCheckLauncher } from '../today-check-launcher';
import { SpendingMonthProvider } from '../spending-month-provider';

// 片づけた直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

/**
 * 確認が必要(明細から開く、提案書「確認を1画面に」、ADR-127)。保存前のレシート(いちばん上、ADR-133)・入力待ち・カテゴリの
 * 確認・この月のカテゴリと差額・店名のゆれ・重複を、この画面だけで片づける。撮り終えたレシートも
 * ここで確かめて保存する。
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ check?: string | string[]; receipt?: string | string[] }>;
} = {}) {
  const { check, receipt } = (await searchParams) ?? {};
  const [data, captures, records, duplicates, merchantNames, plan, checkCount, ready, settings] =
    await Promise.all([
      loadSpendingMonthData(),
      listOpenCaptures().catch(() => []),
      listPendingReviewRecords().catch(() => []),
      listDuplicateReview().catch(() => ({
        candidates: [],
        decided: [],
        storage: 'account' as const,
        hasBrowserDecisions: false,
      })),
      listMerchantNameReviewGroups().then(
        (groups) => ({ groups, error: null }),
        () => ({ groups: [], error: '店名の確認を読み込めませんでした。' }),
      ),
      getCurrentPlan(todayJst()).catch(() => null),
      countTodayCheck().catch(() => 0),
      listReadyReceipts().catch(() => []),
      getAppSettings().catch(() => null),
    ]);
  return (
    <div className="rise flex flex-col gap-4">
      <BackHeader
        back={{ href: '/spending', label: '明細' }}
        title="確認が必要"
        sub="カテゴリ・差額はこの月、ほかはすべての月が対象です"
      />
      <SpendingMonthProvider
        today={data.ledger.period.to}
        currentMonthStart={data.ledger.period.from}
        currentTransactions={data.transactions}
        currentGenreBreakdown={data.ledger.genreBreakdown}
        currentTotals={data.ledger.totals}
        genres={data.genres}
        accounts={data.accounts}
        captures={data.captures}
      >
        <ReviewHub
          todayCheck={
            <TodayCheckLauncher count={checkCount} variant="review" autoOpen={check === 'today'} />
          }
          todayCheckCount={checkCount}
          hasGoal={plan !== null}
          captures={captures}
          ready={ready}
          checkLevel={settings?.receiptCheckLevel ?? 'normal'}
          openFirstReceipt={receipt === 'next'}
          records={records}
          duplicates={duplicates}
          merchantNameGroups={merchantNames.groups}
          merchantNameError={merchantNames.error}
        />
      </SpendingMonthProvider>
    </div>
  );
}
