import { describe, expect, it } from 'vitest';

import { classifyImported, storeMemoryKey } from '@/domain/import-classification';

/** 自信のないときだけ聞く(v4 の共通の土台2、ADR-129)。 */

const genreIdByName = new Map([
  ['カフェ・飲料', 'cafe'],
  ['食料品', 'food'],
]);
const ctx = (memory: [string, { genreId: string; pinned: boolean; hits: number }][] = []) => ({
  memory: new Map(memory),
  genreIdByName,
  threshold: 0.8,
});

describe('取り込んだ明細のカテゴリと、確かめるか', () => {
  it('直したお店(この店はすべて○○)は自信1で、そのまま数える', () => {
    const hit = classifyImported(
      { merchantName: 'ローソン 渋谷店', description: 'VISA' },
      ctx([[storeMemoryKey('ローソン 渋谷店'), { genreId: 'food', pinned: true, hits: 1 }]]),
    );
    expect(hit).toEqual({
      genreId: 'food',
      classifiedBy: 'rule',
      confidence: 1,
      reviewStatus: 'auto_ok',
    });
  });

  it('合ってると押した回数で自信が上がる(1回で しきい値 0.8)', () => {
    const key = storeMemoryKey('まいばすけっと');
    expect(
      classifyImported(
        { merchantName: 'まいばすけっと', description: '' },
        ctx([[key, { genreId: 'food', pinned: false, hits: 1 }]]),
      ),
    ).toMatchObject({ genreId: 'food', reviewStatus: 'auto_ok' });
  });

  it('はじめてのお店は辞書で推測するが、自信が低いので答え合わせでオレンジにする', () => {
    expect(
      classifyImported({ merchantName: null, description: 'スターバックス 新宿' }, ctx()),
    ).toEqual({
      genreId: 'cafe',
      classifiedBy: 'rule',
      confidence: 0.7,
      reviewStatus: 'pending',
    });
  });

  it('決まらなければ未分類のまま、答え合わせへ', () => {
    expect(classifyImported({ merchantName: null, description: 'ABC商会' }, ctx())).toEqual({
      genreId: null,
      classifiedBy: 'unclassified',
      confidence: null,
      reviewStatus: 'pending',
    });
  });

  it('しきい値は設定で変わる', () => {
    const key = storeMemoryKey('まいばすけっと');
    expect(
      classifyImported(
        { merchantName: 'まいばすけっと', description: '' },
        { ...ctx([[key, { genreId: 'food', pinned: false, hits: 1 }]]), threshold: 0.9 },
      ).reviewStatus,
    ).toBe('pending');
  });
});
