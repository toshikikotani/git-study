import { loadSplitPaymentTrackingAction } from '../spending/split-payment-tracking-actions';
import { SplitPaymentReceiptList } from './split-payment-receipts-list';

/** 明細で作った割り勘の依頼を、ホームで受取チェックする。 */
export async function SplitPaymentReceipts() {
  const initial = await loadSplitPaymentTrackingAction();
  return <SplitPaymentReceiptList key={initial.userId} initial={initial} />;
}
