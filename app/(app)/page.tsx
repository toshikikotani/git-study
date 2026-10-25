import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { recordCheckin } from '@/features/checkins/store';
import { shouldShowOnboarding } from '@/features/onboarding/store';
import { loadSavingsSummary } from '@/features/savings/store';
import { AiInsightLine } from './_home/ai-insight-line';
import { HomeHeader } from './_home/home-header';
import { TodayRecords, UpcomingPayments } from './_home/recent-records';
import { TodaySection } from './_home/today-section';
import { TodayTodo } from './_home/today-todo';
import { SplitPaymentReceipts } from './_home/split-payment-receipts';

// サーバー側は常に最新の値を計算する。静的化・サーバー側キャッシュには乗せない
// (ADR-001)。ただし ADR-029 により、この画面自体はブラウザの Router Cache
// (next.config.ts の staleTimes)で一度読み込んだ内容を保持し、pull-to-refresh
// で明示的に引っ張るまで再取得しない。
export const dynamic = 'force-dynamic';

/**
 * ホーム(デザイン仕様書の「今日」、ADR-090):見出し → 今日使える目安 → 今日やること(答え合わせ・入力待ちの
 * レシート・給料日を1枚に。片づけるものがあるときだけ、ADR-131。LINE の「1件ずつ見る」は `?check=today`
 * で開く)→ 今期の見通し → 次の一手 → 貯金 → AIの気づき1行 → 最近の記録。目安をいちばん上に置く。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ check?: string | string[] }>;
} = {}) {
  const { check } = (await searchParams) ?? {};
  // 目標も明細もまだ無い新しい人は、はじめての設定へ(ADR-084)。
  if (await shouldShowOnboarding()) redirect('/welcome');

  // ホームを開いた = 今日確認した(FR-62)。失敗しても画面は止めない。
  const [, savings] = await Promise.all([
    recordCheckin().catch(() => undefined),
    loadSavingsSummary().catch(() => null),
  ]);

  return (
    <div className="hm-page">
      <HomeHeader />
      <Suspense fallback={<TodaySkeleton />}>
        <TodaySection
          savingsNowYen={savings?.thisMonthYen ?? null}
          todo={
            <Suspense fallback={null}>
              <TodayTodo autoOpen={check === 'today'} />
            </Suspense>
          }
          upcoming={
            <Suspense fallback={null}>
              <UpcomingPayments />
            </Suspense>
          }
        />
      </Suspense>
      <Suspense fallback={null}>
        <AiInsightLine />
      </Suspense>
      <Suspense fallback={null}>
        <SplitPaymentReceipts />
      </Suspense>
      <Suspense fallback={null}>
        <TodayRecords />
      </Suspense>
    </div>
  );
}

/** 今日使える目安を読み込んでいる間の枠(高さを先に取り、下の段がずれないようにする)。 */
function TodaySkeleton() {
  return (
    <section
      aria-label="今日使える目安"
      aria-busy="true"
      className="hm-panel hm-section"
      style={{ background: 'var(--surface)' }}
    >
      <p className="text-[15px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        今日の目安
      </p>
      <p className="mt-3 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
        見込みを計算しています…
      </p>
    </section>
  );
}
