import { describe, expect, it } from 'vitest';

import { extractNumbers, verifyNumbersAgainstFacts } from '@/lib/ai-gateway/numeric-verification';

describe('extractNumbers', () => {
  it('文中の数値をすべて抽出する', () => {
    expect(extractNumbers('今日の支出は3500円、平均は1200円です。')).toEqual([3500, 1200]);
  });

  it('桁区切りのカンマを1つの数値として読む', () => {
    expect(extractNumbers('今月の合計は12,345円でした。')).toEqual([12345]);
  });

  it('小数もそのまま読む', () => {
    expect(extractNumbers('比率は0.72です。')).toEqual([0.72]);
  });

  it('数値が無ければ空配列', () => {
    expect(extractNumbers('数字はありません。')).toEqual([]);
  });
});

describe('verifyNumbersAgainstFacts — N1本人要件「渡した事実の中に存在するか検証する」', () => {
  it('facts に含まれる数値だけの文章は ok', () => {
    const result = verifyNumbersAgainstFacts(['今日の支出は3500円でした。'], [3500, 1200]);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('facts に無い数値を含む文章は violations に積まれ、ok は false', () => {
    const result = verifyNumbersAgainstFacts(['今日の支出は9999円でした。'], [3500, 1200]);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([{ text: '今日の支出は9999円でした。', numbers: [9999] }]);
  });

  it('許容誤差(既定0.5)以内の丸め差は違反にしない', () => {
    // 72 と 71.6 の差は 0.4 <= 0.5 なので一致する扱いになる。
    const result = verifyNumbersAgainstFacts(['比率は72%です。'], [71.6]);
    expect(result.ok).toBe(true);
  });

  it('小さい整数(既定13未満、倍率・件数など)は facts に無くても許可する', () => {
    const result = verifyNumbersAgainstFacts(
      ['今日の外食は今月の平均日額の2倍でした。3件の取引がありました。'],
      [],
    );
    expect(result.ok).toBe(true);
  });

  it('大きい数値は facts に無ければ13未満の除外対象にならず違反になる', () => {
    const result = verifyNumbersAgainstFacts(['来月は50000円を目安にしましょう。'], []);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.numbers).toEqual([50000]);
  });

  it('複数の文字列のうち1つでも違反があれば全体が ok:false', () => {
    const result = verifyNumbersAgainstFacts(
      ['今日は3500円でした。', '来月は99999円を見込みます。'],
      [3500],
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.text).toBe('来月は99999円を見込みます。');
  });
});
