import { Card } from '@/components/ui/card';
import { computeInvestmentPlan } from '@/domain/investment';
import { formatYen } from '@/domain/money';
import { listInvestmentContributions, listInvestmentSnapshots } from '@/features/investments/store';
import { getAppSettings } from '@/features/settings/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { ContributionSection } from './contribution-section';
import { HighRiskToggle } from './high-risk-toggle';
import { SnapshotSection } from './snapshot-section';

/**
 * 投資(M7-1, M7-2, M7-3)。
 *
 * 「今月いくら投資に回すか」の自動算出(FR-50)に加え、拠出(フロー)と
 * 残高(ストック)の手入力・一覧(FR-51、証券口座連携は当面対象外)を持つ。
 *
 * 高リスク枠(FR-52)は本人がここで切り替える。以前は全負債の完済で自動に
 * 切り替えていたが、借金をなくした(ADR-081)ので本人の判断にした。
 */

// 切り替え直後の設定を反映するため、常に最新の設定を読む。
export const dynamic = 'force-dynamic';

export default async function InvestmentsPage() {
  const [settings, contributions, snapshots] = await withMinDuration(
    Promise.all([getAppSettings(), listInvestmentContributions(), listInvestmentSnapshots()]),
  );
  const isHighRiskUnlocked = settings.isHighRiskUnlocked;
  const plan = computeInvestmentPlan({
    monthlySavingsTargetYen: settings.monthlySavingsTargetYen,
    investmentRatioOfSavings: settings.investmentRatioOfSavings,
    isHighRiskUnlocked,
    highRiskAllocationRatio: settings.highRiskAllocationRatio,
  });

  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          投資
        </h1>
      </header>

      <Card>
        <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
          今月の投資目安
        </p>
        <p
          className="mt-1 text-3xl font-semibold tracking-[-0.02em]"
          style={{ color: 'var(--ink)' }}
        >
          {formatYen(plan.totalYen, { sign: 'never' })}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          毎月の貯金目標 {formatYen(settings.monthlySavingsTargetYen, { sign: 'never' })} の{' '}
          {Math.round(settings.investmentRatioOfSavings * 100)}%
        </p>

        {isHighRiskUnlocked ? (
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-2xl p-3" style={{ background: 'var(--plane)' }}>
              <p style={{ color: 'var(--ink-muted)' }}>インデックス枠</p>
              <p className="tabular mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
                {formatYen(plan.indexYen, { sign: 'never' })}
              </p>
            </div>
            <div className="rounded-2xl p-3" style={{ background: 'var(--accent-track)' }}>
              <p style={{ color: 'var(--accent)' }}>高リスク枠</p>
              <p className="tabular mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
                {formatYen(plan.highRiskYen, { sign: 'never' })}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            いまは全額インデックス枠です。高リスク枠を使うと、投資総額の
            {Math.round(settings.highRiskAllocationRatio * 100)}%をそちらに回します。
          </p>
        )}
        <HighRiskToggle enabled={isHighRiskUnlocked} />
      </Card>

      <ContributionSection contributions={contributions} />
      <SnapshotSection snapshots={snapshots} />
    </div>
  );
}
