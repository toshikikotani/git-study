import { Suspense } from 'react';
import { MdLocalFireDepartment } from 'react-icons/md';

import { Button } from '@/components/ui/button';
import { ExpandableBudgetTile } from '@/components/ui/expandable-budget-tile';
import { budgetTone } from '@/domain/budget';
import { formatSpendable, formatYen, spendableParts } from '@/domain/money';
import { streakBadgeFor } from '@/domain/streak';
import { loadGenreMonthDetail } from '@/features/genre/genre-detail-store';
import { getCheckinStreak, recordCheckin, type CheckinStreak } from '@/features/checkins/store';
import { loadHomeSummary } from '@/features/home/summary';
import { loadMonthlyLedger } from '@/features/spending/store';
import {
  lockedSavingsYen,
  MISSING_INCOME_NOTE,
  obligationYen,
  sinkingFromRules,
} from '@/domain/locked-savings';
import { listDebts } from '@/features/debts/store';
import { getAppSettings } from '@/features/settings/store';
import { listTransferRules } from '@/features/transfer-rules/store';
import { TodaySection } from './_home/today-section';

// サーバー側は常に最新の値を計算する。静的化・サーバー側キャッシュには乗せない
// (ADR-001)。ただし ADR-029 により、この画面自体はブラウザの Router Cache
// (next.config.ts の staleTimes)で一度読み込んだ内容を保持し、pull-to-refresh
// で明示的に引っ張るまで再取得しない——「常に最新」の保証は、代わりに
// 下の最終更新時刻の表示で担保する(古いままなら本人が見て分かる)。
export const dynamic = 'force-dynamic';

export default async function HomePage() {
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
  const [, summary, ledger, debts, settings, rules] = await Promise.all([
    recordCheckin().catch(() => undefined),
    loadHomeSummary(),
    loadMonthlyLedger().catch(() => null),
    listDebts().catch(() => []),
    getAppSettings().catch(() => null),
    listTransferRules().catch(() => []),
  ]);
  const streak = await getCheckinStreak();
  const { tiles } = summary;
  const obligation = obligationYen(
    debts.reduce((sum, debt) => sum + (debt.status === 'active' ? debt.minimumPaymentYen : 0), 0),
    settings?.monthlyRepaymentTargetYen ?? 0,
  );
  const sinking = sinkingFromRules(rules);
  const scheduled = ledger?.totals.scheduledYen ?? 0;
  const savingsYen = ledger
    ? lockedSavingsYen({
        incomeYen: ledger.totals.incomeYen,
        obligationYen: obligation,
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
      <Suspense fallback={<TodaySkeleton />}>
        <TodaySection />
      </Suspense>

      <section
        className="rise relative overflow-hidden rounded-[22px] px-4 py-4"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
              今日残せる
            </p>
            <StreakBadge streak={streak} />
          </div>

          <p
            className="mt-2 text-2xl leading-none font-semibold tracking-[-0.03em] tabular"
            style={{ color: 'var(--ink)' }}
          >
            {savingsYen === null ? '—' : formatYen(savingsYen)}
          </p>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {savingsYen === null
              ? MISSING_INCOME_NOTE
              : '撮ると、この数字が減る。残った分が貯蓄になる。'}
          </p>
          {savingsYen === null ? (
            <a
              href="/payday"
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              手取りを入れる
              <span aria-hidden>→</span>
            </a>
          ) : null}
        </div>
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
       * 数字(完済・予算タイル)と直接関係の深い2件だけをボタンとして残した。
       */}
      <div className="rise" style={{ animationDelay: `${100 + tiles.length * 70}ms` }}>
        <Button href="/briefs" variant="elevated" className="w-full">
          朝配信のアーカイブを見る
          <span aria-hidden>→</span>
        </Button>
      </div>

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
