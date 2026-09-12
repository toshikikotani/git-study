import { describe, expect, it } from 'vitest';

import { DEFAULT_DETECTION_RULES, type ClassificationRule } from '@/features/classification/rules';
import { buildPreview, type ImportableRow } from '@/features/transactions/import-pipeline';

const ROW: ImportableRow = {
  occurredOn: '2026-09-03',
  description: 'ローソン渋谷',
  amountYen: -3500,
  paymentMethod: 'unknown',
};

describe('buildPreview', () => {
  it('id は idFor が返した値になる', () => {
    const preview = buildPreview([ROW], 'acc-1', (i) => `custom-${i}`);
    expect(preview[0]?.id).toBe('custom-0');
  });

  it('日付・摘要・金額はそのまま渡る', () => {
    const [tx] = buildPreview([ROW], 'acc-1', (i) => `${i}`);
    expect(tx).toMatchObject({
      occurredOn: '2026-09-03',
      description: 'ローソン渋谷',
      amountYen: -3500,
    });
  });

  it('検知ルールに当たれば支払方法が上書きされる(FR-21)', () => {
    const row: ImportableRow = { ...ROW, description: 'リボ払いのご案内' };
    const [tx] = buildPreview([row], 'acc-1', (i) => `${i}`, DEFAULT_DETECTION_RULES);
    expect(tx?.paymentMethod).toBe('revolving');
  });

  it('検知ルールはカテゴリを設定しないので、常に確認待ちになる', () => {
    const row: ImportableRow = { ...ROW, description: 'リボ払いのご案内' };
    const [tx] = buildPreview([row], 'acc-1', (i) => `${i}`, DEFAULT_DETECTION_RULES);
    expect(tx?.categoryId).toBeNull();
    expect(tx?.classifiedBy).toBe('unclassified');
    expect(tx?.reviewStatus).toBe('pending');
  });

  it('カテゴリを設定するルールに当たれば auto_ok になる', () => {
    const rules: ClassificationRule[] = [
      {
        id: 'c1',
        name: 'コンビニ',
        priority: 1,
        matchType: 'keyword',
        pattern: 'ローソン',
        categoryId: 'cat-waste',
        isActive: true,
      },
    ];
    const [tx] = buildPreview([ROW], 'acc-1', (i) => `${i}`, rules);
    expect(tx?.categoryId).toBe('cat-waste');
    expect(tx?.classifiedBy).toBe('rule');
    expect(tx?.reviewStatus).toBe('auto_ok');
  });

  it('categoryNameById を渡すと表示名が入る(M2-5)', () => {
    const rules: ClassificationRule[] = [
      {
        id: 'c1',
        name: 'コンビニ',
        priority: 1,
        matchType: 'keyword',
        pattern: 'ローソン',
        categoryId: 'cat-waste',
        isActive: true,
      },
    ];
    const [tx] = buildPreview(
      [ROW],
      'acc-1',
      (i) => `${i}`,
      rules,
      new Map([['cat-waste', '浪費']]),
    );
    expect(tx?.categoryName).toBe('浪費');
  });

  it('categoryNameById に無い categoryId なら categoryName は null のまま', () => {
    const rules: ClassificationRule[] = [
      {
        id: 'c1',
        name: 'コンビニ',
        priority: 1,
        matchType: 'keyword',
        pattern: 'ローソン',
        categoryId: 'cat-waste',
        isActive: true,
      },
    ];
    const [tx] = buildPreview([ROW], 'acc-1', (i) => `${i}`, rules, new Map());
    expect(tx?.categoryId).toBe('cat-waste');
    expect(tx?.categoryName).toBeNull();
  });

  it('fingerprint は日付・金額・摘要から決定的に作られる', () => {
    const [a] = buildPreview([ROW], 'acc-1', () => 'a');
    const [b] = buildPreview([{ ...ROW }], 'acc-2', () => 'b');
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it('rules を省略すると DEFAULT_DETECTION_RULES が使われる', () => {
    const row: ImportableRow = { ...ROW, description: 'キャッシングのご利用' };
    const [tx] = buildPreview([row], 'acc-1', (i) => `${i}`);
    expect(tx?.paymentMethod).toBe('cashing');
  });

  it('複数行をまとめて処理できる', () => {
    const rows: ImportableRow[] = [ROW, { ...ROW, description: '別の店' }];
    const preview = buildPreview(rows, 'acc-1', (i) => `${i}`);
    expect(preview).toHaveLength(2);
  });

  it('accountId が渡る', () => {
    const [tx] = buildPreview([ROW], 'acc-1', (i) => `${i}`);
    expect(tx?.accountId).toBe('acc-1');
  });

  it('source を省略すると csv になる', () => {
    const [tx] = buildPreview([ROW], 'acc-1', (i) => `${i}`);
    expect(tx?.source).toBe('csv');
  });

  it('source を指定するとそのまま渡る', () => {
    const [tx] = buildPreview([ROW], 'acc-1', (i) => `${i}`, undefined, undefined, 'manual');
    expect(tx?.source).toBe('manual');
  });
});
