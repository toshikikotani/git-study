import { describe, expect, it } from 'vitest';

import { budgetSpokenLabel, budgetState, formatSignedYen } from '@/domain/budget-state';

describe('budgetState', () => {
  it('予算が無い・0円はグレー(なし)。超過にも余裕にもしない(受け入れ基準6)', () => {
    expect(budgetState({ spentYen: 0, budgetYen: 0 })).toBe('none');
    expect(budgetState({ spentYen: 500, budgetYen: null })).toBe('none');
  });

  it('余裕=青、80%以上=注意(黄)、超過=赤', () => {
    expect(budgetState({ spentYen: 5000, budgetYen: 10000 })).toBe('ok');
    expect(budgetState({ spentYen: 8000, budgetYen: 10000 })).toBe('caution');
    expect(budgetState({ spentYen: 10000, budgetYen: 10000 })).toBe('caution');
    expect(budgetState({ spentYen: 10001, budgetYen: 10000 })).toBe('over');
  });

  it('今日時点の理想ラインを超えていれば注意', () => {
    expect(budgetState({ spentYen: 3000, budgetYen: 10000, idealYen: 2000 })).toBe('caution');
    expect(budgetState({ spentYen: 1500, budgetYen: 10000, idealYen: 2000 })).toBe('ok');
  });
});

describe('VoiceOver の読み上げ', () => {
  it('「外食、7,900円のうち5,000円使用、残り2,900円」', () => {
    expect(budgetSpokenLabel('外食', 5000, 7900)).toBe(
      '外食、7,900円のうち5,000円使用、残り2,900円',
    );
  });

  it('超過・予算なし', () => {
    expect(budgetSpokenLabel('外食', 10000, 7900)).toBe(
      '外食、7,900円のうち10,000円使用、2,100円超過',
    );
    expect(budgetSpokenLabel('外食', 5000, null)).toBe('外食、5,000円使用、予算なし');
  });
});

describe('formatSignedYen', () => {
  it('マイナスは U+2212(ハイフンではない)', () => {
    expect(formatSignedYen(-1200)).toBe('−1,200円');
    expect(formatSignedYen(-1200)).not.toContain('-');
    expect(formatSignedYen(300)).toBe('+300円');
    expect(formatSignedYen(0)).toBe('0円');
  });
});
