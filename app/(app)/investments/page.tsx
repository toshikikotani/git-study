import { Card } from '@/components/ui/card';
import { computeInvestmentPlan } from '@/domain/investment';
import { formatYen } from '@/domain/money';
import { getAppSettings } from '@/features/settings/store';

/**
 * 投資(M7-1)。
 *
 * 今はまだ「今月いくら投資に回すか」の自動算出だけ(FR-50)。
 * 拠出・残高の記録(FR-51)は M7-2 でここに足す。
 */

// 完済検知(is_high_risk_unlocked)を反映するため、常に最新の設定を読む。
export const dynamic = 'force-dynamic';

export default async function InvestmentsPage() {
  const settings = await getAppSettings();
  const plan = computeInvestmentPlan({
    monthlyRepaymentTargetYen: settings.monthlyRepaymentTargetYen,
    investmentRatioOfRepayment: settings.investmentRatioOfRepayment,
    isHighRiskUnlocked: settings.isHighRiskUnlocked,
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
          className="mt-1 text-[30px] font-semibold tracking-[-0.02em]"
          style={{ color: 'var(--ink)' }}
        >
          {formatYen(plan.totalYen, { sign: 'never' })}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          返済目標 {formatYen(settings.monthlyRepaymentTargetYen, { sign: 'never' })} の{' '}
          {Math.round(settings.investmentRatioOfRepayment * 100)}%
        </p>

        {settings.isHighRiskUnlocked ? (
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
            完済前は全額インデックス枠です。完済すると高リスク枠(投資総額の
            {Math.round(settings.highRiskAllocationRatio * 100)}%)が解禁されます。
          </p>
        )}
      </Card>
    </div>
  );
}
