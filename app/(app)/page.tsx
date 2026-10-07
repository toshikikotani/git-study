import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { MdLocalFireDepartment } from 'react-icons/md';

import { Button } from '@/components/ui/button';
import { ExpandableBudgetTile } from '@/components/ui/expandable-budget-tile';
import { budgetTone } from '@/domain/budget';
import { formatSpendable, formatYen, spendableParts } from '@/domain/money';
import { streakBadgeFor } from '@/domain/streak';
import { loadGenreMonthDetail } from '@/features/genre/genre-detail-store';
import { getCheckinStreak, recordCheckin, type CheckinStreak } from '@/features/checkins/store';
import { getCurrentAccount } from '@/features/auth/owner';
import { loadHomeSummary } from '@/features/home/summary';
import { shouldShowOnboarding } from '@/features/onboarding/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { todayJst } from '@/lib/date';
import { lockedSavingsYen, MISSING_INCOME_NOTE, sinkingFromRules } from '@/domain/locked-savings';
import { goalOutlook, nextGoal } from '@/domain/savings';
import type { SavingsSummary } from '@/features/savings/store';
import { listTransferRules } from '@/features/transfer-rules/store';
import { HomeHeader } from './_home/home-header';
import { TodaySection } from './_home/today-section';

// サーバー側は常に最新の値を計算する。静的化・サーバー側キャッシュには乗せない
// (ADR-001)。ただし ADR-029 により、この画面自体はブラウザの Router Cache
// (next.config.ts の staleTimes)で一度読み込んだ内容を保持し、pull-to-refresh
// で明示的に引っ張るまで再取得しない——「常に最新」の保証は、代わりに
// 下の最終更新時刻の表示で担保する(古いままなら本人が見て分かる)。
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // 目標も明細もまだ無い新しい人は、はじめての設定へ(ADR-084)。
  if (await shouldShowOnboarding()) redirect('/welcome');

  // ホームを開いた = 今日確認した(FR-62)。失敗しても画面は止めない。
  //
  // recordCheckin() は loadHomeSummary() と依存関係が無い(片方の結果を
  // もう片方が使わない)のに、直列に await していたため、ホームに戻る
  // たびに「確認記録の書き込み」と「3つの数字の読み込み」の往復時間が
  // 単純に合算されていた(モバイル回線・復帰直後の再接続時は特に顕著で、
  // 画面が固まって見える原因になっていた)。並列化して合算を防ぐ。
  //
  // ただし getCheckinStreak() は app_checkins の行を数えるビューを読むため、
  // recordCheckin() の upsert より先に走ると「今日の分」を含め損ねる
  // (バッジの日数が1日ずれる)。そちらは recordCheckin() の後に残す。
  const [, summary, ledger, rules, account] = await Promise.all([
    recordCheckin().catch(() => undefined),
    loadHomeSummary(),
    loadMonthlyLedger().catch(() => null),
    listTransferRules().catch(() => []),
    getCurrentAccount(),
  ]);
  const streak = await getCheckinStreak();
  const { tiles } = summary;
  const sinking = sinkingFromRules(rules);
  const scheduled = ledger?.totals.scheduledYen ?? 0;
  const savingsYen = ledger
    ? lockedSavingsYen({
        incomeYen: ledger.totals.incomeYen,
        sinkingYen: sinking,
        scheduledYen: scheduled,
        discretionaryCapYen: tiles.reduce((sum, tile) => sum + (tile.budgetYen ?? 0), 0),
      })
    : null;

  // タイルを押すとその場で内訳を開く(本人発案:遷移せずに見たい)。
  // タイルは高々数枠(FR-61)なので、ここで内訳もまとめて先読みしておく。
  const tileDetails = await Promise.all(tiles.map((tile) => loadGenreMonthDetail(tile.genreId)));

  // この関数が実際に実行された時刻(=最後にサーバーへ取りに行った時刻)。
  // ADR-029:画面は pull-to-refresh するまで保持されるため、いつ時点の
  // 数字かを本人が判断できるようにする。
  return (
    <div className="space-y-3">
      {/* 設計書 v3 3.1:ホームの主役は「今日あと使える額」。予測は重いので、ほかを待たせない。
          この画面で大きな数字はここだけ(dataviz:ヒーロー figure は1画面に1つ)。 */}
      <HomeHeader />
      <Suspense fallback={<TodaySkeleton />}>
        <TodaySection />
      </Suspense>

      <section
        className="rise relative overflow-hidden rounded-[22px] px-4 py-4"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        <SavingsCard savings={summary.savings} leftThisMonthYen={savingsYen} streak={streak} />
      </section>

      {/* FR-14 / FR-64:残額は肯定形で示す。責める文言を使わない。
          ラベルも表示対象も genres から来る。ここに枠の名前を書かない(ADR-016)。 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile, index) => {
          const tone = budgetTone({
            categoryId: tile.genreId,
            budgetYen: tile.budgetYen,
            carryOverYen: 0,
            spentYen: tile.spentYen,
            remainingYen: tile.remainingYen,
            usageRatio: tile.usageRatio,
            transactionCount: 0,
          });

          return (
            <ExpandableBudgetTile
              key={tile.genreId}
              style={{ animationDelay: `${100 + index * 70}ms` }}
              transactions={tileDetails[index]?.transactions ?? []}
              tile={{
                label: tile.label,
                value: tile.remainingYen === null ? '予算なし' : formatSpendable(tile.remainingYen),
                valueParts:
                  tile.remainingYen === null ? undefined : spendableParts(tile.remainingYen),
                sub:
                  tile.budgetYen === null
                    ? undefined
                    : `${formatYen(tile.spentYen)} / ${formatYen(tile.budgetYen)}`,
                ratio: tile.usageRatio,
                tone,
                note:
                  tile.usageRatio === null ? undefined : `${Math.round(tile.usageRatio * 100)}%`,
              }}
            />
          );
        })}
      </div>

      {tiles.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          ホームに出す枠が選ばれていません。
          <a
            href="/reports/genres"
            className="underline decoration-dotted underline-offset-4"
            style={{ color: 'var(--accent)' }}
          >
            ジャンルの設定
          </a>
          で表示したい枠を選んでください。
        </p>
      ) : null}

      {/*
       * 本人発案(「説明文は遷移先へ。遷移できるものはボタンにし、関連機能の
       * 近くに置く。機能がいっぱいあるように見せない」)。以前はここに
       * 6件の文字リンクが横並びだった。副業・転職準備・Google連携は
       * 「その他」メニュー(P10-1)から辿れるため重複させず削除し、今見ている
       * 数字(貯金・予算タイル)と直接関係の深い2件だけをボタンとして残した。
       */}
      {account.isOwner ? (
        <div className="rise" style={{ animationDelay: `${100 + tiles.length * 70}ms` }}>
          <Button href="/briefs" variant="elevated" className="w-full">
            朝配信のアーカイブを見る
            <span aria-hidden>→</span>
          </Button>
        </div>
      ) : null}

      <div className="rise flex gap-3" style={{ animationDelay: `${170 + tiles.length * 70}ms` }}>
        <Button href="/reports" variant="outlined" className="flex-1">
          支出レポート
        </Button>
        <Button href="/assistant" variant="outlined" className="flex-1">
          AI相談
        </Button>
      </div>
    </div>
  );
}

/**
 * 貯金(ADR-081。以前の「完済まで」の場所)。
 *
 * 貯金目標があれば、貯まった合計と、いちばん近い目標までの残り・届く見込み。
 * 無ければ、今月残せる見込み(手取り − 積立 − 予定 − 予算)と、目標をつくる入口。
 */
function SavingsCard({
  savings,
  leftThisMonthYen,
  streak,
}: {
  savings: SavingsSummary;
  leftThisMonthYen: number | null;
  streak: CheckinStreak;
}) {
  const today = todayJst();
  const next = nextGoal(savings.goals);

  const header = (label: string) => (
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <StreakBadge streak={streak} />
    </div>
  );
  const bigNumber = (text: string) => (
    <p
      className="mt-2 text-2xl leading-none font-semibold tracking-[-0.03em] tabular"
      style={{ color: 'var(--ink)' }}
    >
      {text}
    </p>
  );
  const link = (href: string, text: string) => (
    <a
      href={href}
      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold"
      style={{ color: 'var(--accent)' }}
    >
      {text}
      <span aria-hidden>→</span>
    </a>
  );

  if (next === null) {
    return (
      <div className="relative">
        {header('今月残せる見込み')}
        {bigNumber(leftThisMonthYen === null ? '—' : formatYen(leftThisMonthYen))}
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {leftThisMonthYen === null
            ? MISSING_INCOME_NOTE
            : '貯金目標をつくると、貯まり具合と、いつ届くかが見えます。'}
        </p>
        {leftThisMonthYen === null
          ? link('/payday', '手取りを入れる')
          : link('/savings', '貯金目標をつくる')}
      </div>
    );
  }

  const target = next.goal.targetAmountYen;
  const percent = target === null ? null : Math.round(Math.min(1, next.savedYen / target) * 100);
  return (
    <div className="relative">
      {header('貯金')}
      {bigNumber(formatYen(savings.totalYen, { sign: 'never' }))}
      <p className="mt-3 text-sm" style={{ color: 'var(--ink)' }}>
        {next.goal.title}
        {next.remainingYen !== null && next.remainingYen > 0 ? (
          <span className="tabular ml-2" style={{ color: 'var(--ink-secondary)' }}>
            あと {formatYen(next.remainingYen, { sign: 'never' })}
          </span>
        ) : null}
      </p>
      {percent !== null ? (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--accent-track)' }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${next.goal.title} ${percent}%`}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${percent}%`, background: 'var(--accent)' }}
          />
        </div>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {goalOutlook(next, today)}
      </p>
      {link('/savings', '貯金を見る')}
    </div>
  );
}

/**
 * 連続確認日数のバッジ(FR-62)。
 *
 * 3日未満は出さない(祝うほどではない)。途切れていても責めず、
 * かつて3日以上続いていた実績があるときだけ静かに再開を促す。
 */
function StreakBadge({ streak }: { streak: CheckinStreak }) {
  const badge = streakBadgeFor(streak);
  if (badge.kind === 'none') return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
      style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
    >
      {badge.kind === 'active' ? (
        <>
          <MdLocalFireDepartment aria-hidden size={12} />
          {badge.days}日連続
        </>
      ) : (
        '今日から再開'
      )}
    </span>
  );
}

/** 今日あと使える額を読み込んでいる間の枠(高さを先に取り、下の段がずれないようにする)。 */
function TodaySkeleton() {
  return (
    <section
      aria-label="今日あと使える額"
      aria-busy="true"
      className="rounded-[28px] p-6 pb-7"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        今日 あと
      </p>
      <p className="mt-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
        見込みを計算しています…
      </p>
    </section>
  );
}
