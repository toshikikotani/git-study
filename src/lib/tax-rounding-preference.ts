/**
 * 税込換算の端数処理の設定(N2本人要件「端数処理は切り捨てを初期値とし、
 * 設定で変更可能」)。サーバーに持つほどの重みは無い個人の好みのため、
 * 端末内(localStorage)だけに置く。
 */
import type { TaxRoundingMode } from '@/domain/money';

const STORAGE_KEY = 'tax-rounding-mode';
const DEFAULT_MODE: TaxRoundingMode = 'floor';

export function loadTaxRoundingMode(): TaxRoundingMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'floor' || raw === 'round' || raw === 'ceil') return raw;
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function saveTaxRoundingMode(mode: TaxRoundingMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // プライベートモード等で保存できなくても、既定(切り捨て)で動き続ける。
  }
}
