import { MdLocalFireDepartment } from 'react-icons/md';

import { CountUp } from '@/components/ui/count-up';
import { ExpandableBudgetTile } from '@/components/ui/expandable-budget-tile';
import { ProgressGauge } from '@/components/ui/meter';
import { budgetTone } from '@/domain/budget';
import { formatSpendable, formatYen, spendableParts } from '@/domain/money';
import { streakBadgeFor } from '@/domain/streak';
import { loadGenreMonthDetail } from '@/features/genre/genre-detail-store';
import { getCheckinStreak, recordCheckin, type CheckinStreak } from '@/features/checkins/store';
import { loadHomeSummary } from '@/features/home/summary';
import { formatTimeJa } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';

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
  const [, summary] = await withMinDuration(
    Promise.all([recordCheckin().catch(() => undefined), loadHomeSummary()]),
  );
  const streak = await getCheckinStreak();
  const { payoff } = summary;
  // 予算が無い枠は「予算なし」と空のメーターしか出せず、情報が無い。予算を決めた枠だけ出す。
  const tiles = summary.tiles.filter((tile) => tile.budgetYen !== null);

  // タイルを押すとその場で内訳を開く(本人発案:遷移せずに見たい)。
  // タイルは高々数枠(FR-61)なので、ここで内訳もまとめて先読みしておく。
  const tileDetails = await Promise.all(tiles.map((tile) => loadGenreMonthDetail(tile.genreId)));

  // この関数が実際に実行された時刻(=最後にサーバーへ取りに行った時刻)。
  // ADR-029:画面は pull-to-refresh するまで保持されるため、いつ時点の
  // 数字かを本人が判断できるようにする。
  const updatedAt = formatTimeJa();

  return (
    <div className="space-y-3">
      {/* FR-03:完済カウントダウンは最上部に固定。
          この画面で 48px 超の数字はここだけ(dataviz:ヒーロー figure は1画面に1つ)。 */}
      <section
        className="rise relative overflow-hidden rounded-[28px] p-6 pb-7"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        {/* 数字の背後の淡い光。視線を最上部へ引く */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 -right-20 size-64 rounded-full blur-3xl"
          style={{ background: 'var(--hero-glow)' }}
        />

        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-medium tracking-[0.1em] uppercase"
                style={{ color: 'var(--ink-muted)' }}
              >
                完済まで
              </span>
              {/* ADR-006:推定値が1件でも残るあいだ、確定値として見せない。
                  説明文は置かず、押すと負債の入力へ飛ぶ(ADR-061)。 */}
              {payoff.isEstimated ? (
                <a
                  href="/debts"
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                >
                  推定 ›
                </a>
              ) : null}
            </div>
            <StreakBadge streak={streak} />
          </div>

          <p className="mt-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            最終更新 {updatedAt}
          </p>

          {payoff.daysRemaining === null ? (
            <p
              className="mt-2 text-[56px] leading-none font-semibold tracking-[-0.03em]"
              style={{ color: 'var(--income)' }}
            >
              完済済み
            </p>
          ) : (
            <>
              <p className="mt-1.5 flex items-baseline gap-2">
                <CountUp
                  value={payoff.daysRemaining}
                  className="text-[80px] leading-[0.88] font-semibold tracking-[-0.05em]"
                  style={{ color: 'var(--ink)' }}
                />
                <span className="text-xl font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  日
                </span>
              </p>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span style={{ color: 'var(--ink-secondary)' }}>
                  残り
                  <span className="tabular ml-0.5 font-semibold" style={{ color: 'var(--ink)' }}>
                    {formatYen(payoff.remainingYen)}
                  </span>
                </span>
              </div>

              {/* 残高のスナップショットだけでは「進んでいる」ことが伝わらない。
                  減った分を出すことが、返済アプリの正のフィードバックそのもの。 */}
              {payoff.reducedThisMonthYen > 0 ? (
                <p
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                >
                  <span aria-hidden>↓</span>
                  今月{formatYen(payoff.reducedThisMonthYen)}減らした
                </p>
              ) : null}
            </>
          )}

          <div className="mt-5">
            <ProgressGauge ratio={payoff.progressRatio} label="返済済み" />
          </div>
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
                // 割合はメーターと「使った額 / 予算」で既に伝わる。文字のバッジは、
                // 色だけに頼れない注意・超過のときだけ添える(FR-64)。
                note:
                  tile.usageRatio === null || tone === 'normal'
                    ? undefined
                    : `${Math.round(tile.usageRatio * 100)}%`,
              }}
            />
          );
        })}
      </div>

      {tiles.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          予算を決めたジャンルが、ここに残額として出ます。
          <a
            href="/reports/genres"
            className="underline decoration-dotted underline-offset-4"
            style={{ color: 'var(--accent)' }}
          >
            ジャンルの設定
          </a>
          で予算とホーム表示を選んでください。
        </p>
      ) : null}
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
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
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
