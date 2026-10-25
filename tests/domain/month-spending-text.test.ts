import { describe, expect, it } from 'vitest';

import {
  isMonthSpending,
  monthSpendingText,
  type MonthSpendingRow,
} from '@/domain/month-spending-text';
import { summarizeLedger } from '@/domain/ledger';

/** 1か月分の支出を文字にする(ADR-134)。数え方は明細の「支出」と同じ。 */
const row = (o: Partial<MonthSpendingRow>): MonthSpendingRow => ({
  occurredOn: '2026-10-03',
  label: 'お店',
  amountYen: -1000,
  genreName: '食料品',
  accountId: 'cash',
  memo: null,
  isTransfer: false,
  reviewStatus: 'auto_ok',
  kind: 'normal',
  needsInput: false,
  splits: [],
  ...o,
});

const rows: MonthSpendingRow[] = [
  row({ occurredOn: '2026-10-05', label: 'スギ薬局', amountYen: -1280, genreName: '日用品' }),
  row({ occurredOn: '2026-10-01', label: 'ローソン', amountYen: -300, memo: '朝ごはん' }),
  row({
    occurredOn: '2026-10-07',
    label: 'イオン',
    amountYen: -3000,
    genreName: '食料品',
    accountId: 'card',
    splits: [{ genreName: '食料品' }, { genreName: '日用品' }],
  }),
  row({
    occurredOn: '2026-10-08',
    label: 'ユニクロ',
    amountYen: 500,
    kind: 'refund',
    genreName: '衣服',
  }),
  // 入れないもの:収入・振替・数えない・入力待ち・予定・ほかの月
  row({ occurredOn: '2026-10-10', label: '給料', amountYen: 250000 }),
  row({ label: '口座へ移す', isTransfer: true }),
  row({ label: '重複', reviewStatus: 'ignored' }),
  row({ label: '入力待ち', needsInput: true }),
  row({ occurredOn: '2026-10-30', label: '家賃', amountYen: -80000 }),
  row({ occurredOn: '2026-09-30', label: '先月', amountYen: -999 }),
];

const text = () =>
  monthSpendingText({
    monthStart: '2026-10-01',
    today: '2026-10-25',
    rows,
    spentYen: 4080,
    scheduledYen: 80000,
    genreBreakdown: [
      { genreName: '日用品', spentYen: 1580 },
      { genreName: '食料品', spentYen: 3000 },
      { genreName: '衣服', spentYen: -500 },
      { genreName: '外食', spentYen: 0 },
    ],
    accountName: (id) => ({ cash: '現金', card: '楽天カード' })[id] ?? null,
  });

describe('1か月分の支出の文字', () => {
  it('月の合計と件数、予定は別に書く', () => {
    const lines = text().split('\n');
    expect(lines[0]).toBe('2026年10月の支出(25日まで)');
    expect(lines[1]).toBe('合計 4,080円 · 4件');
    expect(lines[2]).toBe('(このほか予定 80,000円)');
  });

  it('カテゴリ別の合計は多い順(0円は出さない)', () => {
    const t = text();
    expect(t).toContain('【カテゴリ別】\n食料品 3,000円\n日用品 1,580円\n衣服 −500円');
    expect(t).not.toContain('外食');
  });

  it('1件ずつは日付の順。お店・金額・カテゴリ・支払い・メモ。品目は支払い1行にまとめる', () => {
    expect(text()).toContain(
      [
        '【1件ずつ】',
        '10/1(木) ローソン 300円 食料品 / 現金(朝ごはん)',
        '10/5(月) スギ薬局 1,280円 日用品 / 現金',
        '10/7(水) イオン 3,000円 食料品・日用品 / 楽天カード',
        '10/8(木) 返金 ユニクロ −500円 衣服 / 現金',
      ].join('\n'),
    );
  });

  it('入れるものは明細の「支出」と同じ(1件ずつの合計が支出に合う)', () => {
    const today = '2026-10-25';
    const counted = rows.filter(
      (r) => r.occurredOn.startsWith('2026-10') && isMonthSpending(r, today),
    );
    const sum = counted.reduce((n, r) => n - r.amountYen, 0);
    const summary = summarizeLedger(
      rows
        .filter((r) => !r.needsInput)
        .map((r, i) => ({ ...r, id: String(i), categoryId: r.genreName })),
      { from: '2026-10-01', to: '2026-10-31' },
      today,
    );
    expect(sum).toBe(summary.spentYen);
  });

  it('支出が無い月', () => {
    const t = monthSpendingText({
      monthStart: '2026-09-01',
      today: '2026-10-25',
      rows: [],
      spentYen: 0,
      scheduledYen: 0,
      genreBreakdown: [],
      accountName: () => null,
    });
    expect(t).toBe('2026年9月の支出\n合計 0円 · 0件\n\nこの月の支出はまだありません。');
  });
});
