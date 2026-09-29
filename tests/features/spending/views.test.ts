import { describe, expect, it } from 'vitest';

import { summarizeLedger } from '@/domain/ledger';
import { formatRemainingDays, remainingDays } from '@/domain/period';
import { planGuidance } from '@/domain/spending-plan';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { buildLedgerViews, toLedgerEntries } from '@/features/spending/views';

/**
 * 受け入れ基準1・2・7:同じ期間なら、ヘッダー・ジャンル内訳・明細・カレンダー・
 * 目標の合計が一致する。未来日の特別費は実績にも目標の見込みにも入らない。
 */

const TODAY = '2026-09-29';
const genres = [
  { id: 'dining', name: '外食', budget_yen: 20000 },
  { id: 'food', name: '食料品', budget_yen: null },
  { id: 'drug', name: '日用品', budget_yen: 5000 },
  { id: 'cafe', name: 'カフェ・飲料', budget_yen: 0 },
  { id: 'event', name: '発表会', budget_yen: null },
];

function tx(o: Partial<LedgerTransaction> & { id: string }): LedgerTransaction {
  return {
    occurredOn: '2026-09-10',
    label: o.id,
    genreId: 'dining',
    genreName: '外食',
    amountYen: -1000,
    accountId: 'a',
    paymentMethod: 'one_time',
    branchName: null,
    reconcileDiffYen: null,
    mustPay: false,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    status: 'actual',
    kind: 'normal',
    splits: [],
    ...o,
  };
}

const transactions: LedgerTransaction[] = [
  tx({ id: 'a', occurredOn: '2026-09-02', amountYen: -7900 }),
  tx({ id: 'b', occurredOn: '2026-09-15', amountYen: -4379 }),
  tx({ id: 'c', occurredOn: '2026-09-15', genreId: 'food', genreName: '食料品', amountYen: -6000 }),
  // 分割: 子のジャンル未設定の1件は親(日用品)を引き継ぐ
  tx({
    id: 'd',
    occurredOn: '2026-09-20',
    label: 'ココカラファイン',
    genreId: 'drug',
    genreName: '日用品',
    amountYen: -3000,
    splits: [
      { genreId: 'drug', genreName: '日用品', amountYen: -1200 },
      { genreId: 'cafe', genreName: 'カフェ・飲料', amountYen: -1800 },
    ],
  }),
  tx({ id: 'e', occurredOn: '2026-09-25', genreId: null, genreName: null, amountYen: -663 }),
  tx({ id: 'f', occurredOn: '2026-09-26', amountYen: 200000, genreId: null, genreName: null }),
  // 未来日の特別費(9/29 に予定として登録した 10/3 の発表会)
  tx({
    id: 'g',
    occurredOn: '2026-10-03',
    genreId: 'event',
    genreName: '発表会',
    amountYen: -26540,
    kind: 'special',
    status: 'scheduled',
  }),
];

describe('全画面の合計が一致する(受け入れ基準1)', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' };
  const views = buildLedgerViews({ genres, transactions, range, today: TODAY });
  const expected = 7900 + 4379 + 6000 + 3000 + 663;

  it('ヘッダー(使った額)', () => {
    expect(views.totals.spentYen).toBe(expected);
  });

  it('ジャンル内訳の合計(未分類を含む)= ヘッダー', () => {
    expect(views.genreBreakdown.reduce((acc, r) => acc + r.spentYen, 0)).toBe(expected);
  });

  it('明細の日別合計 = ヘッダー', () => {
    expect(views.dayGroups.reduce((acc, g) => acc + g.spentYen, 0)).toBe(expected);
  });

  it('カレンダーの日別金額の合計 = ヘッダー', () => {
    const days = Object.values(views.totals.daySpend);
    expect(days.reduce((acc, v) => acc + v, 0)).toBe(expected);
  });

  it('目標側のジャンル別実績 + 未分類 + 特別費 = ヘッダー', () => {
    const s = summarizeLedger(toLedgerEntries(transactions), range, TODAY);
    const byGenre = [...s.byGenrePace.values()].reduce((acc, v) => acc + v, 0);
    expect(byGenre + s.specialYen).toBe(expected);
  });

  it('同じジャンルの金額が、内訳と目標で一致する(外食 12,279円)', () => {
    const s = summarizeLedger(toLedgerEntries(transactions), range, TODAY);
    expect(views.genreBreakdown.find((r) => r.genreId === 'dining')?.spentYen).toBe(12279);
    expect(s.byGenrePace.get('dining')).toBe(12279);
  });

  it('分割の子が親のジャンルを引き継ぎ、未分類が増えない', () => {
    expect(views.genreBreakdown.find((r) => r.genreId === 'drug')?.spentYen).toBe(1200);
    expect(views.genreBreakdown.find((r) => r.genreId === 'cafe')?.spentYen).toBe(1800);
    expect(views.summary.uncategorizedYen).toBe(663);
  });

  it('未来日の取引は「予定」に分かれ、実績にも日別にも入らない', () => {
    expect(views.scheduled.map((t) => t.id)).toEqual([]); // 9月の範囲外
    const october = buildLedgerViews({
      genres,
      transactions,
      range: { from: '2026-10-01', to: '2026-10-31' },
      today: TODAY,
    });
    expect(october.scheduled.map((t) => t.id)).toEqual(['g']);
    expect(october.totals.spentYen).toBe(0);
    expect(october.totals.scheduledYen).toBe(26540);
  });
});

describe('未来日の特別費で目標の見込みが破綻しない(受け入れ基準2)', () => {
  const periodStart = '2026-09-29';
  const periodEnd = '2026-10-06';

  it('9/29 に 10/3 の発表会(特別費・予定)を登録しても、実績と見込みに入らない', () => {
    const summary = summarizeLedger(
      toLedgerEntries([
        tx({ id: 'x', occurredOn: '2026-09-29', amountYen: -2500 }),
        transactions[6]!,
      ]),
      { from: periodStart, to: periodEnd },
      TODAY,
    );
    expect(summary.spentYen).toBe(2500);
    expect(summary.paceSpentYen).toBe(2500);
    expect(summary.scheduledYen).toBe(26540);

    const guidance = planGuidance({
      periodStart,
      periodEnd,
      today: TODAY,
      items: [
        {
          genreId: 'dining',
          genreName: '外食',
          targetYen: 21000,
          spentYen: summary.byGenrePace.get('dining') ?? 0,
        },
      ],
    });
    // 1日目 2,500円 × 8日 = 20,000円。256,336円のような破綻した値にならない。
    expect(guidance.projectedYen).toBe(20000);
    expect(guidance.projectedYen).toBeLessThan(21000 + 1);
  });
});

describe('「残りN日」の表記が一致する(受け入れ基準7)', () => {
  it('目標の指針・期間表示・日数関数がすべて同じ値', () => {
    const periodStart = '2026-09-29';
    const periodEnd = '2026-10-06';
    for (const today of ['2026-09-29', '2026-10-01', '2026-10-06']) {
      const guidance = planGuidance({
        periodStart,
        periodEnd,
        today,
        items: [{ genreId: 'g', genreName: '外食', targetYen: 10000, spentYen: 0 }],
      });
      const n = remainingDays(periodStart, periodEnd, today);
      expect(guidance.remainingDays).toBe(n);
      expect(formatRemainingDays(periodStart, periodEnd, today)).toBe(`残り${n}日`);
      expect(guidance.genres[0]!.message).toContain(`残り${n}日`);
    }
  });
});
