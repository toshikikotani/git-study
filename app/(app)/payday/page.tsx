import { resolvePaydayChecklistState } from '@/features/transfer-runs/store';
import { todayJst } from '@/lib/date';
import { PaydayAmountForm, PaydayChecklist } from './checklist';

/**
 * 給料日は入金額だけを聞く。振替ルール(返済へ・投資へ等)は使わない。
 */

export const dynamic = 'force-dynamic';

export default async function PaydayPage() {
  const checklistState = await resolvePaydayChecklistState(todayJst());

  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          給料日
        </h1>
      </header>
      {checklistState.kind === 'needs_amount' ? (
        <PaydayAmountForm paydayOn={checklistState.paydayOn} />
      ) : checklistState.kind === 'checklist' ? (
        <PaydayChecklist run={checklistState.run} />
      ) : (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          給料日になったら、入った額だけ入れます。
        </p>
      )}
    </div>
  );
}
