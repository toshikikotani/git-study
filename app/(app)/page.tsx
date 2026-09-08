import { ProgressGauge } from '@/components/ui/meter';
import { StatTile } from '@/components/ui/stat-tile';
import { budgetTone } from '@/domain/budget';
import { formatSpendable, formatYen } from '@/domain/money';
import { loadHomeSummary } from '@/features/home/summary';
import { formatDateJa } from '@/lib/date';

// 金額は常に最新でなければならない。App Router のキャッシュに乗せない(ADR-001)。
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const summary = await loadHomeSummary();
  const { payoff, tiles } = summary;

  return (
    <div className="space-y-4">
      {/* FR-03:完済カウントダウンは最上部に固定。
          この画面で 48px 超の数字はここだけ(dataviz:ヒーロー figure は1画面に1つ)。 */}
      <section
        className="rise relative overflow-hidden rounded-3xl p-6 pb-7"
        style={{
          background: 'var(--surface-raised)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px -12px rgba(0,0,0,0.12)',
        }}
      >
        {/* 数字の背後の淡い光。視線を最上部へ引く */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full blur-3xl"
          style={{ background: 'var(--hero-glow)' }}
        />

        <div className="relative">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-medium tracking-[0.08em] uppercase"
              style={{ color: 'var(--ink-muted)' }}
            >
              完済まで
            </span>
            {/* ADR-006:推定値が1件でも残るあいだ、確定値として見せない */}
            {payoff.isEstimated ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                推定
              </span>
            ) : null}
          </div>

          {payoff.daysRemaining === null ? (
            <p
              className="mt-2 text-5xl font-semibold tracking-tight"
              style={{ color: 'var(--good)' }}
            >
              完済済み
            </p>
          ) : (
            <>
              <p className="mt-2 flex items-baseline gap-1.5">
                <span
                  className="text-[64px] leading-[0.95] font-semibold tracking-[-0.04em]"
                  style={{ color: 'var(--ink)' }}
                >
                  {payoff.daysRemaining.toLocaleString('ja-JP')}
                </span>
                <span className="text-lg font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  日
                </span>
              </p>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                  残り<span className="tabular font-medium">{formatYen(payoff.remainingYen)}</span>
                </span>
                {payoff.payoffOn ? (
                  <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(payoff.payoffOn)}
                  </span>
                ) : null}
              </div>
            </>
          )}

          <div className="mt-5">
            <ProgressGauge ratio={payoff.progressRatio} label="返済済み" />
          </div>

          {/* リンクを本文に混ぜると行をまたいで割れる。行を分けて動線として立てる。 */}
          {payoff.isEstimated ? (
            <div className="mt-4">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                残高と金利に推定値が含まれています。正確な値を入れると、この日付が確定します。
              </p>
              <a
                href="/debts"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium"
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
      <div className="grid gap-4 sm:grid-cols-2">
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
              style={{ animationDelay: `${80 + index * 60}ms` }}
            >
              <StatTile
                label={tile.label}
                value={tile.remainingYen === null ? '予算なし' : formatSpendable(tile.remainingYen)}
                sub={tile.budgetYen === null ? undefined : `予算 ${formatYen(tile.budgetYen)}`}
                ratio={tile.usageRatio}
                tone={tone}
                note={
                  tile.usageRatio === null
                    ? undefined
                    : `予算の${Math.round(tile.usageRatio * 100)}%`
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

      <p className="pt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        表示中の数値は ADR-006 の仮置きです。Supabase 接続後に実データへ切り替わります。
      </p>
    </div>
  );
}
