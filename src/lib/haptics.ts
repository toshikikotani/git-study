/**
 * ハプティクス(触覚フィードバック)の対応表。全画面で同じ意味には同じ触覚を返す。
 *
 *   selection … 選択の変化(タブ切り替え、グラフをなぞる1日ごと)
 *   impact    … 確定(カテゴリ移動、保存)。軽い衝撃
 *   success   … 成功(一括操作の完了、ルール保存)
 *   warning   … 取り消せないに近い操作の確認(削除の確定)
 *
 * 実装:Vibration API(Android・一部ブラウザ)。iOS の Safari には Vibration API が無いため、
 * iOS 18 以降で触覚が出る `<input type="checkbox" switch>` のラベルを押す方法で近似する
 * (出ない環境では何も起きない。動きと文言だけで意味が伝わるようにしてある)。
 */

export type HapticKind = 'selection' | 'impact' | 'success' | 'warning';

/** Vibration API のパターン(ミリ秒。振動,休止,振動…)。 */
export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 6,
  impact: 12,
  success: [10, 40, 16],
  warning: [24, 50, 24],
};

/** どの操作でどの触覚か(全画面で統一するための表。テストで固定する)。 */
export const HAPTIC_FOR_ACTION = {
  tabChange: 'selection',
  chartScrub: 'selection',
  filterChange: 'selection',
  categoryMove: 'impact',
  save: 'impact',
  genreConfirm: 'impact',
  bulkComplete: 'success',
  ruleSaved: 'success',
  deleteConfirm: 'warning',
} as const satisfies Record<string, HapticKind>;

export type HapticAction = keyof typeof HAPTIC_FOR_ACTION;

type VibrateNavigator = { vibrate?: (pattern: number | number[]) => boolean };

/** 触覚を返す。返せる環境がなければ false(何もしない)。 */
export function haptic(
  kind: HapticKind,
  nav: VibrateNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  doc: Pick<Document, 'createElement' | 'body'> | undefined = typeof document === 'undefined'
    ? undefined
    : document,
): boolean {
  if (nav && typeof nav.vibrate === 'function') {
    return nav.vibrate(HAPTIC_PATTERNS[kind]);
  }
  return iosSwitchTick(doc);
}

export function hapticFor(action: HapticAction): boolean {
  return haptic(HAPTIC_FOR_ACTION[action]);
}

/** iOS: switch 型のチェックボックスのラベルを押すと、システムの触覚が出る。 */
function iosSwitchTick(doc: Pick<Document, 'createElement' | 'body'> | undefined): boolean {
  if (!doc?.body) return false;
  try {
    const label = doc.createElement('label') as HTMLLabelElement;
    const input = doc.createElement('input') as HTMLInputElement;
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:0;height:0';
    label.appendChild(input);
    doc.body.appendChild(label);
    label.click();
    label.remove();
    return true;
  } catch {
    return false;
  }
}
