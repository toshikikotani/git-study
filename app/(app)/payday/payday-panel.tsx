import { resolvePaydayChecklistState } from '@/features/transfer-runs/store';
import { todayJst } from '@/lib/date';
import { PaydayAmountForm, PaydayChecklist } from './checklist';

/**
 * 給料日の振り分け(入った額を入れて、振り分けを確かめる)。給料日には今日の画面のカードから、ほかの日は
 * 設定から、シートで開く(もとは「給料日」の画面、ADR-127)。振替ルール(貯金へ・投資へ等)は使わない。
 */
export async function loadPaydayState() {
  return resolvePaydayChecklistState(todayJst()).catch(() => null);
}

export function PaydayPanel({ state }: { state: Awaited<ReturnType<typeof loadPaydayState>> }) {
  if (state?.kind === 'needs_amount') return <PaydayAmountForm paydayOn={state.paydayOn} />;
  if (state?.kind === 'checklist') return <PaydayChecklist run={state.run} />;
  return (
    <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
      給料日になったら、入った額だけ入れます。
    </p>
  );
}
