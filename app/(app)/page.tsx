import { ProgressGauge, StatTile } from '@/components/ui/stat-tile';
import { loadHomeSummary } from '@/features/home/summary';
import { formatSpendable, formatYen } from '@/domain/money';
import { formatDateJa } from '@/lib/date';

// 金額は常に最新でなければならない。App Router のキャッシュに乗せない(ADR-001)。
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const summary = await loadHomeSummary();
  const { payoff, living, sanctuary } = summary;

  return (
    <div className="space-y-4">
      {/* FR-03: 完済カウントダウンは最上部に固定。スクロールせずに見えること */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">完済まで</span>
          {payoff.isEstimated ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              推定
            </span>
          ) : null}
        </div>

        {payoff.daysRemaining === null ? (
          <p className="mt-1 text-4xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-400">
            完済済み
          </p>
        ) : (
          <>
            <p className="mt-1 text-4xl font-semibold tracking-tight">
              残り{payoff.daysRemaining.toLocaleString('ja-JP')}日
            </p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              残り{formatYen(payoff.remainingYen)}
              {payoff.payoffOn ? ` ・ ${formatDateJa(payoff.payoffOn)}` : null}
            </p>
          </>
        )}

        <div className="mt-4">
          <ProgressGauge ratio={payoff.progressRatio} label="返済済み" />
        </div>

        {/* ADR-006: 推定値が残るあいだ、完済予定日を確定値として見せない */}
        {payoff.isEstimated ? (
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            残高と金利に推定値が含まれています。
            <a href="/debts" className="underline underline-offset-2">
              正確な値を入力する
            </a>
            と、この日付が確定します。
          </p>
        ) : null}
      </section>

      {/* FR-14 / FR-64: 残額は肯定形で示す。責める文言を使わない */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="生活費"
          value={formatSpendable(living.remainingYen)}
          sub={`予算 ${formatYen(living.budgetYen)}`}
          tone={living.remainingYen >= 0 ? 'neutral' : 'warn'}
        />
        <StatTile
          label="女遊び枠"
          value={formatSpendable(sanctuary.remainingYen)}
          sub={`予算 ${formatYen(sanctuary.budgetYen)}`}
          tone={sanctuary.remainingYen >= 0 ? 'positive' : 'warn'}
        />
      </div>

      <p className="pt-2 text-xs text-neutral-400 dark:text-neutral-500">
        表示中の数値は ADR-006 の仮置きです。Supabase 接続(M0-2 /
        M0-3)後に実データへ切り替わります。
      </p>
    </div>
  );
}
