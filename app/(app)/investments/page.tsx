import { Card } from '@/components/ui/card';
import { computeInvestmentPlan } from '@/domain/investment';
import { formatYen } from '@/domain/money';
import {
  checkAndUnlockHighRisk,
  listInvestmentContributions,
  listInvestmentSnapshots,
} from '@/features/investments/store';
import { getAppSettings } from '@/features/settings/store';
import { ContributionSection } from './contribution-section';
import { SnapshotSection } from './snapshot-section';

/**
 * 投資(M7-1, M7-2, M7-3)。
 *
 * 「今月いくら投資に回すか」の自動算出(FR-50)に加え、拠出(フロー)と
 * 残高(ストック)の手入力・一覧(FR-51、証券口座連携は当面対象外)を持つ。
 *
 * 全負債の完済を検知して高リスク枠を解禁する処理(FR-52)もここで行う。
 * アクセスするたびに判定するので、`/debts` で完済した次にこの画面を
 * 開いたタイミングで自動的に切り替わる(本人が別途操作する必要はない)。
 */

// 完済検知(is_high_risk_unlocked)を反映するため、常に最新の設定を読む。
export const dynamic = 'force-dynamic';

export default async function InvestmentsPage() {
  const justUnlocked = await checkAndUnlockHighRisk();
  const [settings, contributions, snapshots] = await Promise.all([
    getAppSettings(),
    listInvestmentContributions(),
    listInvestmentSnapshots(),
  ]);
  // Next.js の fetch リクエストメモ化により、checkAndUnlockHighRisk() 内で読んだ
  // app_settings と同じクエリがこのレンダー内で再利用され、更新直後の1回だけは
  // settings.isHighRiskUnlocked が更新前の値のまま返ることがある。justUnlocked
  // (今回のアクセスで解禁したかどうか)を合わせて見ることで、解禁直後の表示も
  // 次回アクセスと同じ内容にする。
  const isHighRiskUnlocked = settings.isHighRiskUnlocked || justUnlocked;
  const plan = computeInvestmentPlan({
    monthlyRepaymentTargetYen: settings.monthlyRepaymentTargetYen,
    investmentRatioOfRepayment: settings.investmentRatioOfRepayment,
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

      {justUnlocked ? (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--accent-track)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            高リスク枠が解禁されました
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            全ての負債を完済しました。今月から投資の配分にインデックス7:高リスク3が適用されます。
          </p>
        </div>
      ) : null}

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
            完済前は全額インデックス枠です。完済すると高リスク枠(投資総額の
            {Math.round(settings.highRiskAllocationRatio * 100)}%)が解禁されます。
          </p>
        )}
      </Card>

      <ContributionSection contributions={contributions} />
      <SnapshotSection snapshots={snapshots} />
    </div>
  );
}
