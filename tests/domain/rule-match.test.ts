import { describe, expect, it } from 'vitest';

import {
  describeRule,
  findRuleMatches,
  ruleMatches,
  storeKeyOf,
  suggestRule,
  type RuleCandidate,
} from '../../src/domain/rule-match';
import { CONFIDENT, predictGenres } from '../../src/domain/genre-prediction';
import { classifyLine, memoryKey, STORE_WIDE_ITEM } from '../../src/domain/classification-pipeline';
import { planWholeMove, applyPlanToInput } from '../../src/domain/category-move';

const cand = (
  id: string,
  label: string,
  items: string[],
  genreId: string | null,
  date = '2026-09-01',
  amountYen = -500,
): RuleCandidate => ({ id, occurredOn: date, label, amountYen, genreId, itemNames: items });

describe('P7 ルールの提案(受け入れ基準:カテゴリを変えた直後にルール化を提案)', () => {
  it('品目単位:「今後も[店名]の[品目名]は[カテゴリ]にしますか?」', () => {
    const s = suggestRule(
      [{ storeName: 'ファミリーマート 梅田店', itemNames: ["TULLY'S ブラック"] }],
      'カフェ・飲料',
    );
    expect(s?.scope).toEqual({
      kind: 'item',
      storeName: 'ファミリーマート',
      itemName: "TULLY'S ブラック",
    });
    expect(s?.question).toBe("今後もファミリーマートのTULLY'S ブラックはカフェ・飲料にしますか?");
  });

  it('同じ店の品目を3件以上まとめて移したら、店単位:「[店名]は今後すべて[カテゴリ]にしますか?」', () => {
    const s = suggestRule(
      [
        { storeName: 'ローソン', itemNames: ['お茶', 'パン'] },
        { storeName: 'ローソン 渋谷店', itemNames: ['牛乳'] },
        { storeName: 'ドトール', itemNames: ['コーヒー'] },
      ],
      '食料品',
    );
    expect(s?.scope).toEqual({ kind: 'store', storeName: 'ローソン' });
    expect(s?.question).toBe('ローソンは今後すべて食料品にしますか?');
  });

  it('品目の無い明細は1件と数える。3件以上なら店単位、それ未満で品目も無ければ店単位で提案', () => {
    const three = suggestRule(
      [1, 2, 3].map(() => ({ storeName: 'セブン-イレブン', itemNames: [] })),
      '食料品',
    );
    expect(three?.scope.kind).toBe('store');
    expect(suggestRule([{ storeName: '山田商店', itemNames: [] }], '食料品')?.scope.kind).toBe(
      'store',
    );
    expect(suggestRule([], '食料品')).toBeNull();
    expect(suggestRule([{ storeName: '', itemNames: [] }], '食料品')).toBeNull();
  });
});

describe('P7 ルールに一致する過去の取引(受け入れ基準11:保存前に件数と一覧)', () => {
  const all = [
    cand('1', 'ファミリーマート梅田店', ["TULLY'S ブラック"], 'dining', '2026-09-03'),
    cand('2', 'ファミリーマート', ['ＴＵＬＬＹ’Ｓ ブラック', 'おにぎり'], null, '2026-08-20'),
    cand('3', 'ファミリーマート', ['おにぎり'], 'dining', '2026-08-01'),
    cand('4', 'ローソン', ["TULLY'S ブラック"], 'dining', '2026-08-05'),
    cand('5', 'ファミリーマート', ["TULLY'S ブラック"], 'cafe', '2026-07-01'), // すでに移し先
    cand('6', 'ファミリーマート', ["TULLY'S ブラック"], 'dining', '2026-07-02', 300), // 収入・返金は対象外
  ];

  it('品目ルール:同じ店・同じ品目(表記ゆれをまとめる)の取引だけ。新しい日付が先頭', () => {
    const scope = {
      kind: 'item',
      storeName: 'ファミリーマート',
      itemName: "TULLY'S ブラック",
    } as const;
    const m = findRuleMatches(scope, 'cafe', all);
    expect(m.map((c) => c.id)).toEqual(['1', '2']);
    expect(ruleMatches(scope, all[3]!)).toBe(false); // 別の店
  });

  it('店ルール:同じ店のすべての取引(品目に関わらず)。すでに移し先のものは除く', () => {
    const m = findRuleMatches({ kind: 'store', storeName: 'ファミリーマート' }, 'cafe', all);
    expect(m.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('店名の比較は支店名・表記ゆれを無視する', () => {
    expect(storeKeyOf('ファミリーマート 梅田店')).toBe(storeKeyOf('ﾌｧﾐﾘｰﾏｰﾄ'));
    expect(describeRule({ kind: 'store', storeName: 'ローソン' })).toBe('ローソン は すべて');
    expect(describeRule({ kind: 'item', storeName: 'ローソン', itemName: 'お茶' })).toBe(
      'ローソン の お茶',
    );
  });
});

describe('P7 店ごとのルールは、分類パイプラインで最優先で効く', () => {
  it('「この店はすべて○○」(item=*)は、店の履歴・辞書より先に当たる。店×品目の指定はそれより強い', () => {
    const memory = new Map([
      [`${'ローソン'}|${STORE_WIDE_ITEM}`, { genreId: 'food', pinned: true, hits: 1 }],
    ]);
    const ctx = { memory, genreIdByName: new Map([['カフェ・飲料', 'cafe']]) };
    const key = (s: string) => memoryKey(s, 'x').split('|')[0];
    expect(key('ローソン')).toBe('ローソン');
    expect(classifyLine('ローソン', "TULLY'S ブラック", ctx)).toMatchObject({
      genreId: 'food',
      source: 'rule',
      confidence: 1,
    });
    memory.set(memoryKey('ローソン', "TULLY'S ブラック"), {
      genreId: 'cafe',
      pinned: true,
      hits: 1,
    });
    expect(classifyLine('ローソン', "TULLY'S ブラック", ctx)?.genreId).toBe('cafe');
    expect(classifyLine('ドトール', 'コーヒー', ctx)?.source).not.toBe('rule');
  });

  it('すべてを1つのカテゴリへ移す計画(店ルールを過去に当てる)', () => {
    const input = {
      amountYen: -3000,
      genreId: 'dining',
      splits: [
        { genreId: 'dining', amountYen: -1000, note: null },
        { genreId: 'cafe', amountYen: -2000, note: null },
      ],
      items: [{ id: 'a', name: 'a', amountYen: -3000, genreId: 'cafe' }],
    };
    const plan = planWholeMove(input, 'food');
    expect(plan).toMatchObject({ genreId: 'food', splits: [] });
    expect(applyPlanToInput(input, plan).items[0]!.genreId).toBe('food');
  });
});

describe('P7 未分類の予測(すべて予測どおりに確定は信頼度0.9以上だけ)', () => {
  const genres = [
    { id: 'health', name: '医療・健康' },
    { id: 'goods', name: '日用品' },
    { id: 'cafe', name: 'カフェ・飲料' },
    { id: 'food', name: '食料品' },
  ];

  it('同じ店で同じジャンルをくり返し選んでいるほど信頼度が高い(2回で0.9、3回以上で0.95に近づく)', () => {
    const p = (n: number) =>
      predictGenres({
        storeName: 'ココカラファイン',
        genres,
        history: [{ storeName: 'ココカラファイン', genreId: 'health', count: n }],
      })[0]!;
    expect(p(1).confidence).toBeCloseTo(0.8, 5);
    expect(p(2).confidence).toBeGreaterThanOrEqual(CONFIDENT);
    expect(p(9).confidence).toBe(0.95);
  });

  it('選び方がばらばらな店は、0.9に届かない。辞書は0.9、店の種類・よく使うは低い', () => {
    const mixed = predictGenres({
      storeName: 'ココカラファイン',
      genres,
      history: [
        { storeName: 'ココカラファイン', genreId: 'health', count: 3 },
        { storeName: 'ココカラファイン', genreId: 'goods', count: 3 },
      ],
    })[0]!;
    expect(mixed.confidence).toBeLessThan(CONFIDENT);
    const dict = predictGenres({
      storeName: 'x',
      itemNames: ["TULLY'S ラテ"],
      genres,
      history: [],
    })[0]!;
    expect(dict).toMatchObject({ reason: 'dictionary', confidence: 0.9 });
    const fallback = predictGenres({ storeName: '山田商店', genres, history: [] })[0]!;
    expect(fallback.confidence).toBeLessThan(CONFIDENT);
  });
});
