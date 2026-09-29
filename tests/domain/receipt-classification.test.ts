import { describe, expect, it } from 'vitest';

import { STORE_TYPE_GENRE } from '@/domain/classification-dictionary';
import {
  applyCorrection,
  classifyLine,
  memoryKey,
  type ClassificationMemory,
} from '@/domain/classification-pipeline';
import { findReceiptDuplicates } from '@/domain/receipt-duplicate';
import { normalizeStoreName } from '@/domain/store-name';

const genreIdByName = new Map([
  ['食料品', 'g-food'],
  ['カフェ・飲料', 'g-cafe'],
  ['日用品', 'g-goods'],
  ['医療・健康', 'g-med'],
]);

describe('normalizeStoreName', () => {
  it('チェーン名と支店名に分ける(ココカラファイン阪神大阪梅田駅店)', () => {
    expect(normalizeStoreName('ココカラファイン阪神大阪梅田駅店')).toEqual({
      name: 'ココカラファイン',
      branch: '阪神大阪梅田駅店',
      type: 'drugstore',
    });
  });

  it('表記ゆれ・全角・株式会社を吸収する', () => {
    expect(normalizeStoreName('株式会社セブンイレブン 渋谷1丁目店')).toMatchObject({
      name: 'セブン-イレブン',
      branch: '渋谷1丁目店',
    });
    expect(normalizeStoreName('ＴＵＬＬＹ’Ｓ ＣＯＦＦＥＥ 梅田店')).toMatchObject({
      name: "TULLY'S COFFEE",
      branch: '梅田店',
      type: 'cafe',
    });
  });

  it('辞書に無い店は、空白区切りの末尾の「〜店」を支店名にする', () => {
    expect(normalizeStoreName('ふじ食堂 本町店')).toMatchObject({
      name: 'ふじ食堂',
      branch: '本町店',
    });
  });

  it('どちらにも当たらなければそのまま(支店なし)', () => {
    expect(normalizeStoreName('山田商店')).toMatchObject({ name: '山田商店', branch: null });
  });
});

describe('分類パイプライン', () => {
  const store = 'ココカラファイン';
  const ctx = (memory: ClassificationMemory = new Map()) => ({ memory, genreIdByName });

  it("品目辞書:TULLY'S はカフェ・飲料(受け入れ基準3)", () => {
    expect(classifyLine("TULLY'S COFFEE", "TULLY'S ハニーラテ", ctx())).toMatchObject({
      genreId: 'g-cafe',
      source: 'dictionary',
    });
  });

  it('辞書に無く履歴も無ければ null(AI 推定へ)', () => {
    expect(classifyLine(store, 'よくわからない商品XYZ', ctx())).toBeNull();
  });

  it('利用者のルール > 個人の履歴 > 品目辞書 の順に効く', () => {
    const history: ClassificationMemory = new Map([
      [memoryKey(store, 'コーヒー'), { genreId: 'g-food', pinned: false, hits: 2 }],
    ]);
    expect(classifyLine(store, 'コーヒー', ctx(history))).toMatchObject({
      genreId: 'g-food',
      source: 'history',
    });

    const rule: ClassificationMemory = new Map([
      ...history,
      [memoryKey('', 'コーヒー'), { genreId: 'g-goods', pinned: true, hits: 1 }],
    ]);
    expect(classifyLine(store, 'コーヒー', ctx(rule))).toMatchObject({
      genreId: 'g-goods',
      source: 'rule',
    });
  });

  it('その店での履歴を、品目だけの履歴より優先する', () => {
    const memory: ClassificationMemory = new Map([
      [memoryKey(store, 'ミネラルウォーター'), { genreId: 'g-goods', pinned: false, hits: 1 }],
      [memoryKey('', 'ミネラルウォーター'), { genreId: 'g-food', pinned: false, hits: 1 }],
    ]);
    expect(classifyLine(store, 'ミネラルウォーター', ctx(memory))?.genreId).toBe('g-goods');
  });

  it('利用者が直した内容は、履歴へ即座に反映され、次回の分類に使われる', () => {
    let memory: ClassificationMemory = new Map();
    expect(classifyLine(store, 'コーヒー', ctx(memory))?.source).toBe('dictionary');
    memory = applyCorrection(memory, { storeName: store, itemName: 'コーヒー', genreId: 'g-food' });
    expect(classifyLine(store, 'コーヒー', ctx(memory))).toMatchObject({
      genreId: 'g-food',
      source: 'history',
    });
    // 同じ選び方を重ねると確信度が上がり、別のジャンルへ直すと切り替わる
    const twice = applyCorrection(memory, {
      storeName: store,
      itemName: 'コーヒー',
      genreId: 'g-food',
    });
    expect(twice.get(memoryKey(store, 'コーヒー'))?.hits).toBe(2);
    const switched = applyCorrection(twice, {
      storeName: store,
      itemName: 'コーヒー',
      genreId: 'g-goods',
    });
    expect(switched.get(memoryKey(store, 'コーヒー'))).toMatchObject({
      genreId: 'g-goods',
      hits: 1,
    });
  });

  it('店の種類から親の初期ジャンルを決める', () => {
    expect(STORE_TYPE_GENRE.drugstore).toBe('日用品');
    expect(STORE_TYPE_GENRE.cafe).toBe('カフェ・飲料');
    expect(STORE_TYPE_GENRE.other).toBeNull();
  });
});

describe('保存前の重複警告', () => {
  const existing = [
    { id: 'a', storeName: 'ココカラファイン', occurredOn: '2026-09-20', amountYen: -3000 },
    { id: 'b', storeName: 'ココカラファイン', occurredOn: '2026-09-19', amountYen: -3000 },
    { id: 'c', storeName: 'ローソン', occurredOn: '2026-09-20', amountYen: -3000 },
  ];

  it('同じ店・同じ日・近い金額を候補にする', () => {
    const hit = findReceiptDuplicates(
      { storeName: 'ココカラファイン', occurredOn: '2026-09-20', amountYen: -3050 },
      existing,
    );
    expect(hit.map((h) => h.id)).toEqual(['a']);
  });

  it('金額が離れていれば候補にしない', () => {
    expect(
      findReceiptDuplicates(
        { storeName: 'ココカラファイン', occurredOn: '2026-09-20', amountYen: -9000 },
        existing,
      ),
    ).toEqual([]);
  });
});
