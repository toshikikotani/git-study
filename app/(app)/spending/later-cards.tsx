import { loadAccumulationView } from '@/features/accumulation/store';
import { loadSpendingDiagnosisView } from '@/features/diagnosis/store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { InsightsCard } from './insights-card';
import { SubscriptionsCard } from './subscriptions-card';

/** 明細を開くのを待たせない。診断と定期支出は後から足す。 */
export async function LaterCards({ totalSpentYen }: { totalSpentYen: number }) {
  const [diagnosis, pile, subscriptions] = await Promise.all([
    loadSpendingDiagnosisView(),
    loadAccumulationView(),
    loadDetectedSubscriptions(),
  ]);
  return (
    <>
      <InsightsCard
        view={diagnosis}
        totalSpentYen={totalSpentYen}
        pile={{ thresholdYen: pile.thresholdYen, smallSpendTotalYen: pile.smallSpendTotalYen }}
      />
      <SubscriptionsCard subscriptions={subscriptions} />
    </>
  );
}
