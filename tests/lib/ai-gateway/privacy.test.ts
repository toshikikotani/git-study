import { describe, expect, it } from 'vitest';

import { maskPii } from '@/lib/ai-gateway/privacy';

describe('maskPii — N1本人要件「カード番号や電話番号などの個人情報はマスクする」', () => {
  it('16桁のカード番号らしき数字列をマスクする', () => {
    expect(maskPii('カード番号は1234567890123456です')).toBe(
      'カード番号は[カード番号を非表示]です',
    );
  });

  it('ハイフン区切りのカード番号もマスクする', () => {
    expect(maskPii('1234-5678-9012-3456 で決済しました')).toBe(
      '[カード番号を非表示] で決済しました',
    );
  });

  it('日本の電話番号(0で始まる)をマスクする', () => {
    expect(maskPii('電話番号は090-1234-5678です')).toBe('電話番号は[電話番号を非表示]です');
  });

  it('店名・品目名・金額・日付は変えない', () => {
    const text = 'ローソン渋谷店でコーヒー150円を2026-09-30に購入';
    expect(maskPii(text)).toBe(text);
  });

  it('短い数字(4桁の金額など)はマスクしない', () => {
    expect(maskPii('3500円でした')).toBe('3500円でした');
  });
});
