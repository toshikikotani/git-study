/**
 * 予算の状態(色と文言を決める唯一の判定)。全画面(家計簿・目標)で同じものを使う。
 *
 *   ok       余裕    青
 *   caution  注意    黄  予算の80%以上を使った、または今日時点の理想ペースを超えている
 *   over     超過    赤  予算を超えた。赤は超過とエラーにだけ使う
 *   reserved 予定で確保済み  中立(グレー)。予定の支出で予算のほぼ全額が確保されていて、余裕とは扱わない
 *   none     予算なし グレー  予算が未設定・0円。「順調です」「1日0円まで」などは出さない
 *
 * 色だけに頼らず、必ずアイコンとラベルを併用する(STATE_LABEL / STATE_ICON)。
 */

import { formatYen } from '@/domain/money';

export type BudgetState = 'ok' | 'caution' | 'over' | 'none' | 'reserved';

export const CAUTION_RATIO = 0.8;

/** 予定の支出が予算のこの割合以上なら「予定で確保済み」(domain/spending-plan.ts と同じ値)。 */
const RESERVED_RATIO = 0.8;

export function budgetState(input: {
  spentYen: number;
  budgetYen: number | null;
  /** 今日時点の理想ライン(予算を期間で均等に使った場合の額)。無ければ null。 */
  idealYen?: number | null;
  /** このジャンルの予定の支出(今日より先)。 */
  scheduledYen?: number;
}): BudgetState {
  const { spentYen, budgetYen } = input;
  if (budgetYen === null || budgetYen <= 0) return 'none';
  const scheduledYen = input.scheduledYen ?? 0;
  if (spentYen > budgetYen || spentYen + scheduledYen > budgetYen) return 'over';
  if (scheduledYen > 0 && scheduledYen >= budgetYen * RESERVED_RATIO) return 'reserved';
  if (spentYen >= budgetYen * CAUTION_RATIO) return 'caution';
  if (input.idealYen != null && spentYen > input.idealYen) return 'caution';
  return 'ok';
}

export const STATE_LABEL: Record<BudgetState, string> = {
  ok: '余裕',
  caution: '注意',
  over: '超過',
  none: '予算なし',
  reserved: '予定で確保済み',
};

/** 状態を示す記号(色に頼らない併用表示)。 */
export const STATE_ICON: Record<BudgetState, string> = {
  ok: '●',
  caution: '▲',
  over: '!',
  none: '–',
  reserved: '◧',
};

/** 状態色の CSS 変数(app/globals.css)。 */
export const STATE_COLOR: Record<BudgetState, string> = {
  ok: 'var(--state-ok)',
  caution: 'var(--state-caution)',
  over: 'var(--state-over)',
  none: 'var(--state-none)',
  reserved: 'var(--state-none)',
};

export const STATE_TRACK: Record<BudgetState, string> = {
  ok: 'var(--state-ok-track)',
  caution: 'var(--state-caution-track)',
  over: 'var(--state-over-track)',
  none: 'var(--state-none-track)',
  reserved: 'var(--state-none-track)',
};

/**
 * VoiceOver 向けの読み上げ。
 *   「外食、7,900円のうち5,000円使用、残り2,900円」
 *   超過:「外食、7,900円のうち10,000円使用、2,100円超過」
 *   予算なし:「外食、5,000円使用、予算なし」
 */
export function budgetSpokenLabel(
  name: string,
  spentYen: number,
  budgetYen: number | null,
): string {
  const spent = formatYen(spentYen, { sign: 'never' });
  if (budgetYen === null || budgetYen <= 0) return `${name}、${spent}使用、予算なし`;
  const budget = formatYen(budgetYen, { sign: 'never' });
  const diff = budgetYen - spentYen;
  return diff >= 0
    ? `${name}、${budget}のうち${spent}使用、残り${formatYen(diff, { sign: 'never' })}`
    : `${name}、${budget}のうち${spent}使用、${formatYen(-diff, { sign: 'never' })}超過`;
}

/** 金額の符号付き表示。マイナスは U+2212(−)。等幅数字と組み合わせて使う。 */
export function formatSignedYen(value: number): string {
  if (value === 0) return formatYen(0);
  const abs = formatYen(Math.abs(value));
  return value < 0 ? `−${abs}` : `+${abs}`;
}
