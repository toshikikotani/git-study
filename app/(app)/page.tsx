import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { formatYen } from '@/domain/money';
import { nextGoal } from '@/domain/savings';
import { recordCheckin } from '@/features/checkins/store';
import { shouldShowOnboarding } from '@/features/onboarding/store';
import { loadSavingsSummary, type SavingsSummary } from '@/features/savings/store';
import { HomeHeader } from './_home/home-header';
import type { HomeListProps } from './_home/home-list';
import { TodaySection } from './_home/today-section';

// サーバー側は常に最新の値を計算する。静的化・サーバー側キャッシュには乗せない
// (ADR-001)。ただし ADR-029 により、この画面自体はブラウザの Router Cache
// (next.config.ts の staleTimes)で一度読み込んだ内容を保持し、pull-to-refresh
// で明示的に引っ張るまで再取得しない。
export const dynamic = 'force-dynamic';

/**
 * ホーム(デザインの「今日」、ADR-085):見出し → 今日使える額 → 見通し → 次の一手 → 一覧
 * (月末に残る見込み・確認待ち・貯金)。予算の残額タイルと下のボタンは、デザインに合わせて外した
 * (ジャンルは「見通し」、レポートとAI相談はナビと「その他」から)。
 */
export default async function HomePage() {
  // 目標も明細もまだ無い新しい人は、はじめての設定へ(ADR-084)。
  if (await shouldShowOnboarding()) redirect('/welcome');

  // ホームを開いた = 今日確認した(FR-62)。失敗しても画面は止めない。
  const [, savings] = await Promise.all([
    recordCheckin().catch(() => undefined),
    loadSavingsSummary().catch(() => null),
  ]);

  return (
    <div className="space-y-3">
      <HomeHeader />
      <Suspense fallback={<TodaySkeleton />}>
        <TodaySection savings={savingsRow(savings)} />
      </Suspense>
    </div>
  );
}

/** 一覧の「貯金」の行(本人の選択で、デザインの一覧に足した)。 */
function savingsRow(savings: SavingsSummary | null): HomeListProps['savings'] {
  if (savings === null) return null;
  const next = nextGoal(savings.goals);
  if (next === null) return { title: '貯金', detail: '目標をつくる' };
  return {
    title: `貯金 · ${next.goal.title}`,
    detail: formatYen(savings.totalYen, { sign: 'never' }),
  };
}

/** 今日使える額を読み込んでいる間の枠(高さを先に取り、下の段がずれないようにする)。 */
function TodaySkeleton() {
  return (
    <section
      aria-label="今日使える額"
      aria-busy="true"
      className="glass rounded-[28px] p-6 pb-7"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-base font-medium" style={{ color: 'var(--ink-secondary)' }}>
        今日 使えるのは
      </p>
      <p className="mt-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
        見込みを計算しています…
      </p>
    </section>
  );
}
