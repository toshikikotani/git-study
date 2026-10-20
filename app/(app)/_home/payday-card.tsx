import { DetailSheet } from '@/components/ui/detail-sheet';
import { loadPaydayState, PaydayPanel } from '../payday/payday-panel';

/**
 * 給料日のカード(提案書「給料日は今日のカード＋シート」、ADR-127)。給料日に入った額を入れる・振り分けを
 * 確かめる間だけ出し、「振り分ける」でシートを開く(画面を移らない)。ほかの日は出さない(設定から開ける)。
 */
export async function PaydayCard() {
  const state = await loadPaydayState();
  if (state === null || (state.kind !== 'needs_amount' && state.kind !== 'checklist')) return null;
  return (
    <section
      aria-labelledby="payday-card"
      className="flex items-center gap-3 rounded-[22px] px-4 py-3"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <h2 id="payday-card" className="text-[17px] font-semibold">
          給料日です
        </h2>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {state.kind === 'needs_amount'
            ? '入った額を入れると、振り分けを出します'
            : '振り分けを確かめる'}
        </span>
      </span>
      <DetailSheet label="振り分ける" title="給料日の振り分け">
        <PaydayPanel state={state} />
      </DetailSheet>
    </section>
  );
}
