import { MdLocalFireDepartment } from 'react-icons/md';

import { Button } from '@/components/ui/button';
import { CountUp } from '@/components/ui/count-up';
import { ExpandableBudgetTile } from '@/components/ui/expandable-budget-tile';
import { ProgressGauge } from '@/components/ui/meter';
import { budgetTone } from '@/domain/budget';
import { formatSpendable, formatYen, spendableParts } from '@/domain/money';
import { streakBadgeFor } from '@/domain/streak';
import { loadCategoryMonthDetail } from '@/features/categories/category-detail-store';
import { getCheckinStreak, recordCheckin, type CheckinStreak } from '@/features/checkins/store';
import { loadHomeSummary } from '@/features/home/summary';
import { formatDateJa } from '@/lib/date';

// 金額は常に最新でなければならない。App Router のキャッシュに乗せない(ADR-001)。
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
  const [, summary] = await Promise.all([
    recordCheckin().catch(() => undefined),
    loadHomeSummary(),
  ]);
  const streak = await getCheckinStreak();
  const { payoff, tiles } = summary;

  // タイルを押すとその場で内訳を開く(本人発案:遷移せずに見たい)。
  // タイルは高々数枠(FR-61)なので、ここで内訳もまとめて先読みしておく。
  const tileDetails = await Promise.all(
    tiles.map((tile) => loadCategoryMonthDetail(tile.categoryId)),
  );

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
              {/* ADR-006:推定値が1件でも残るあいだ、確定値として見せない */}
              {payoff.isEstimated ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                >
                  推定
                </span>
              ) : null}
            </div>
            <StreakBadge streak={streak} />
          </div>

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
                {payoff.payoffOn ? (
                  <span style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(payoff.payoffOn)} 完済見込み
                  </span>
                ) : null}
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
            <ProgressGauge
              ratio={payoff.progressRatio}
              label="返済済み"
              nextMilestone={payoff.nextMilestone}
            />
          </div>

          {/* リンクを本文に混ぜると行をまたいで割れる。行を分けて動線として立てる。 */}
          {payoff.isEstimated ? (
            <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--hairline)' }}>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                残高と金利に推定値が含まれています。正確な値を入れると、この日付が確定します。
              </p>
              <a
                href="/debts"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                負債を入力する
                <span aria-hidden>→</span>
              </a>
            </div>
          ) : null}
        </div>
      </section>

      {/* FR-14 / FR-64:残額は肯定形で示す。責める文言を使わない。
          ラベルも表示対象も categories から来る。ここに枠の名前を書かない(ADR-016)。 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile, index) => {
          const tone = budgetTone(
            {
              categoryId: tile.categoryId,
              code: tile.code,
              budgetYen: tile.budgetYen,
              carryOverYen: 0,
              spentYen: tile.spentYen,
              remainingYen: tile.remainingYen,
              usageRatio: tile.usageRatio,
              transactionCount: 0,
            },
            tile.code === 'sanctuary' ? 'sanctuary' : 'other',
          );

          return (
            <ExpandableBudgetTile
              key={tile.categoryId}
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
            href="/rules"
            className="underline decoration-dotted underline-offset-4"
            style={{ color: 'var(--accent)' }}
          >
            カテゴリの設定
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
        <Button href="/advisor" variant="outlined" className="flex-1">
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
