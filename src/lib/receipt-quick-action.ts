export type ReceiptQuickAction = 'camera' | 'manual';
export const RECEIPT_QUICK_ACTION_KEY = 'receipt-quick-action';
export function parseReceiptQuickAction(value: string | null): ReceiptQuickAction {
  return value === 'manual' ? 'manual' : 'camera';
}
export function readReceiptQuickAction(): ReceiptQuickAction {
  try {
    return parseReceiptQuickAction(localStorage.getItem(RECEIPT_QUICK_ACTION_KEY));
  } catch {
    return 'camera';
  }
}

export const RECEIPT_QUICK_ACTION_EVENT = 'receipt-quick-action-changed';
