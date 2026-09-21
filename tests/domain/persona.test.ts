import { describe, expect, it } from 'vitest';

import {
  SPENDING_PERSONA_DESCRIPTIONS,
  SPENDING_PERSONA_LABELS,
  SPENDING_PERSONA_TYPES,
} from '@/domain/persona';

describe('spending persona 定義 — 抜け漏れが無いこと', () => {
  it('全タイプにラベルがある', () => {
    for (const type of SPENDING_PERSONA_TYPES) {
      expect(SPENDING_PERSONA_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  it('全タイプに説明がある', () => {
    for (const type of SPENDING_PERSONA_TYPES) {
      expect(SPENDING_PERSONA_DESCRIPTIONS[type].length).toBeGreaterThan(0);
    }
  });

  it('タイプが重複していない', () => {
    expect(new Set(SPENDING_PERSONA_TYPES).size).toBe(SPENDING_PERSONA_TYPES.length);
  });
});
