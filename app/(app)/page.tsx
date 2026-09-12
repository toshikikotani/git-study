import Link from 'next/link';

import { CountUp } from '@/components/ui/count-up';
import { ProgressGauge } from '@/components/ui/meter';
import { StatTile } from '@/components/ui/stat-tile';
import { budgetTone } from '@/domain/budget';
import { formatSpendable, formatYen, spendableParts } from '@/domain/money';
import { streakBadgeFor } from '@/domain/streak';
import { getCheckinStreak, recordCheckin, type CheckinStreak } from '@/features/checkins/store';
import { loadHomeSummary } from '@/features/home/summary';
import { formatDateJa } from '@/lib/date';

// 金額は常に最新でなければならない。App Router のキャッシュに乗せない(ADR-001)。
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // ホームを開いた = 今日確認した(FR-62)。失敗しても画面は止めない。
  await recordCheckin().catch(() => undefined);
  const [summary, streak] = await Promise.all([loadHomeSummary(), getCheckinStreak()]);
  const { payoff, tiles } = summary;

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
            <div
              key={tile.categoryId}
              className="rise"
              style={{ animationDelay: `${100 + index * 70}ms` }}
            >
              <StatTile
                label={tile.label}
                value={tile.remainingYen === null ? '予算なし' : formatSpendable(tile.remainingYen)}
                valueParts={
                  tile.remainingYen === null ? undefined : spendableParts(tile.remainingYen)
                }
                sub={
                  tile.budgetYen === null
                    ? undefined
                    : `${formatYen(tile.spentYen)} / ${formatYen(tile.budgetYen)}`
                }
                ratio={tile.usageRatio}
                tone={tone}
                note={
                  tile.usageRatio === null ? undefined : `${Math.round(tile.usageRatio * 100)}%`
                }
              />
            </div>
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

      <Link
        href="/briefs"
        className="inline-flex items-center gap-1 px-1 text-xs font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        朝配信のアーカイブ
        <span aria-hidden>→</span>
      </Link>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
        <Link
          href="/side-hustle"
          className="inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          副業トラッカー
          <span aria-hidden>→</span>
        </Link>
        <Link
          href="/job-change"
          className="inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          転職準備
          <span aria-hidden>→</span>
        </Link>
      </div>

      <p className="px-1 pt-0.5 text-[10px] opacity-70" style={{ color: 'var(--ink-muted)' }}>
        数値は仮置き(ADR-006)。Supabase 接続後に実データへ切り替わります。
      </p>
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
          <span aria-hidden>🔥</span>
          {badge.days}日連続
        </>
      ) : (
        '今日から再開'
      )}
    </span>
  );
}
