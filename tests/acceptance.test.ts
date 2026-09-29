import { describe, expect, it } from 'vitest';

import { budgetSpokenLabel, budgetState } from '@/domain/budget-state';
import { goalImpact } from '@/domain/goal-impact';
import { formatRemainingDays, remainingDays } from '@/domain/period';
import { reconcileReceipt } from '@/domain/receipt-reconcile';
import { planGuidance } from '@/domain/spending-plan';
import { canShowForecast, countRecordedDays, paceComparison } from '@/domain/summary-rules';
import { buildGoalView } from '@/features/goals/view';
import { classifyReceiptPipeline } from '@/features/genre/receipt-classify';
import { buildFromAiRows } from '@/features/import/receipt-ai';
import { buildReceiptSavePlan } from '@/features/import/receipt-save';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { buildAttention, buildLedgerViews, toLedgerEntries } from '@/features/spending/views';
import { ledgerSplit, ledgerTx } from './helpers/ledger';

/**
 * 依頼の受け入れ基準 1〜9(9 はホーム・給料日タブの既存テストが全て通ること。
 * tests/features/home-summary.test.ts・tests/domain/payday-period.test.ts ほか、
 * 全テストの通過で確認する)。
 */

const TODAY = '2026-09-29';
const genres = [
  { id: 'dining', name: '外食', budget_yen: 20000 },
  { id: 'food', name: '食料品', budget_yen: null },
  { id: 'goods', name: '日用品', budget_yen: 5000 },
  { id: 'cafe', name: 'カフェ・飲料', budget_yen: 0 },
  { id: 'event', name: '発表会', budget_yen: null },
];
const genreNames = new Map(genres.map((g) => [g.id, g.name]));

const month = { from: '2026-09-01', to: '2026-09-30' };
const ledger: LedgerTransaction[] = [
  ledgerTx({ id: 'a', occurredOn: '2026-09-02', amountYen: -7900 }),
  ledgerTx({ id: 'b', occurredOn: '2026-09-15', amountYen: -4379 }),
  ledgerTx({
    id: 'c',
    occurredOn: '2026-09-15',
    genreId: 'food',
    genreName: '食料品',
    amountYen: -6000,
  }),
  ledgerTx({ id: 'e', occurredOn: '2026-09-25', genreId: null, genreName: null, amountYen: -663 }),
  ledgerTx({
    id: 'sp',
    occurredOn: '2026-09-27',
    genreId: 'event',
    amountYen: -9000,
    kind: 'special',
  }),
  ledgerTx({
    id: 'fut',
    occurredOn: '2026-10-03',
    genreId: 'event',
    amountYen: -26540,
    kind: 'special',
    status: 'scheduled',
  }),
];

describe('受け入れ基準1:ヘッダー・ジャンル内訳・明細・カレンダー・目標で、同じ期間なら合計が一致する', () => {
  const views = buildLedgerViews({ genres, transactions: ledger, range: month, today: TODAY });
  const expected = 7900 + 4379 + 6000 + 663 + 9000;

  it('全画面の合計が同じ(未来日の予定は含まれない)', () => {
    const goalSummary = buildGoalView({
      plan: {
        id: 'p',
        periodStart: month.from,
        periodEnd: month.to,
        items: [
          { genreId: 'dining', genreName: '外食', targetYen: 20000 },
          { genreId: 'food', genreName: '食料品', targetYen: 10000 },
        ],
      },
      entries: toLedgerEntries(ledger),
      genreNames,
      today: TODAY,
    });
    const header = views.totals.spentYen;
    const breakdown = views.genreBreakdown.reduce((a, r) => a + r.spentYen, 0);
    const list = views.dayGroups.reduce((a, g) => a + g.spentYen, 0);
    const calendar = Object.values(views.totals.daySpend).reduce((a, v) => a + v, 0);
    // 目標:ペースの実績(予算あり + なし + 未分類) + 特別費 = 使った額
    const goal =
      goalSummary.breakdown.reduce((a, r) => a + r.spentYen, 0) + goalSummary.guidance.specialYen;
    expect([header, breakdown, list, calendar, goal]).toEqual(Array(5).fill(expected));
  });

  it('同じジャンルの金額が内訳と目標で一致する(外食 12,279円)', () => {
    expect(views.genreBreakdown.find((r) => r.genreId === 'dining')?.spentYen).toBe(12279);
  });
});

describe('受け入れ基準2:10/3 の発表会 26,540円を 9/29 に特別費・予定として登録しても、使った額にも目標の見込みにも入らない', () => {
  it('使った額に入らず、目標の見込みも破綻しない', () => {
    const txs = [
      ledgerTx({ id: 'x', occurredOn: '2026-09-29', genreId: 'dining', amountYen: -2500 }),
      ledgerTx({
        id: 'fut',
        occurredOn: '2026-10-03',
        genreId: 'event',
        amountYen: -26540,
        kind: 'special',
        status: 'scheduled',
      }),
    ];
    const views = buildLedgerViews({ genres, transactions: txs, range: month, today: TODAY });
    expect(views.totals.spentYen).toBe(2500);

    const goal = buildGoalView({
      plan: {
        id: 'p',
        periodStart: '2026-09-29',
        periodEnd: '2026-10-06',
        items: [{ genreId: 'dining', genreName: '外食', targetYen: 21000 }],
      },
      entries: toLedgerEntries(txs),
      genreNames,
      today: TODAY,
    });
    expect(goal.guidance.spentYen).toBe(2500);
    expect(goal.guidance.projectedYen).toBeNull();
    expect(goal.guidance.headline).not.toMatch(/\d{3},\d{3}円/);
  });
});

describe("受け入れ基準3:ココカラファインの分割レシートで「未分類」が出ず、TULLY'S がカフェ・飲料に分類される", () => {
  it('読み取り → 分類 → 保存 → 家計簿の内訳まで', async () => {
    const item = (name: string, amount_yen: number) => ({
      name,
      amount_yen,
      product_type: '',
      tax_rate: 10,
      is_discount: false,
      confidence: 0.9,
      y_ratio: 0.3,
    });
    const parsed = buildFromAiRows([
      {
        occurred_on: '2026-09-20',
        amount_yen: 3000,
        store_name: 'ココカラファイン阪神大阪梅田駅店',
        payment_method_text: '現金',
        items: [
          item("TULLY'S ハニーラテ", 800),
          item('ハンドクリーム', 1500),
          item('不明な商品XYZ', 700),
        ],
        expense_subtype: '',
        price_basis: 'tax_included',
        tax_8_yen: 0,
        tax_10_yen: 0,
        points_used_yen: 0,
        coupon_yen: 0,
        store_confidence: 1,
        date_confidence: 1,
        total_confidence: 1,
      },
    ]).transactions[0]!;

    const options = genres.map((g) => ({ id: g.id, name: g.name }));
    const result = await classifyReceiptPipeline(null, [parsed], options, new Map());
    const genreByLineId = new Map(
      result.classifications.map((c) => [
        parsed.items[Number(c.key.split(':')[1])]!.lineId!,
        c.genreId,
      ]),
    );
    expect(genreByLineId.get('l0')).toBe('cafe'); // TULLY'S → カフェ・飲料

    const plan = buildReceiptSavePlan({
      parsed,
      accountId: 'a',
      parentGenreId: result.parentGenreIds.get(0) ?? null,
      genreByLineId,
      kind: 'normal',
      sourceRef: 'r',
    });
    const tx = ledgerTx({
      id: 'coco',
      occurredOn: '2026-09-20',
      label: plan.transaction.merchantName!,
      genreId: plan.transaction.genreId,
      genreName: '日用品',
      amountYen: plan.transaction.amountYen,
      splits: plan.splits!.map((s, i) =>
        ledgerSplit({
          genreId: s.genreId,
          amountYen: s.amountYen,
          genreName: genreNames.get(s.genreId ?? '') ?? null,
          id: `s${i}`,
        }),
      ),
    });
    const views = buildLedgerViews({ genres, transactions: [tx], range: month, today: TODAY });
    expect(views.genreBreakdown.some((r) => r.genreId === null)).toBe(false); // 未分類が出ない
    expect(views.genreBreakdown.find((r) => r.genreId === 'cafe')?.spentYen).toBe(800);
    expect(views.genreBreakdown.reduce((a, r) => a + r.spentYen, 0)).toBe(3000);
    expect(buildAttention([tx], TODAY).uncategorized.count).toBe(0);
  });
});

describe('受け入れ基準4:税率8%と10%が混在し、値引きとポイント払いを含むレシートで合計不一致が出ない', () => {
  it('照合が一致する', () => {
    const item = (name: string, amount_yen: number, tax_rate: number, is_discount = false) => ({
      name,
      amount_yen,
      product_type: '',
      tax_rate,
      is_discount,
      confidence: 0.9,
      y_ratio: 0.5,
    });
    const t = buildFromAiRows([
      {
        occurred_on: '2026-09-20',
        amount_yen: 1996,
        store_name: 'スーパー',
        payment_method_text: '',
        items: [
          item('パン', 648, 8),
          item('牛乳', 648, 8),
          item('洗剤', 1100, 10),
          item('値引', 100, 8, true),
        ],
        expense_subtype: '',
        price_basis: 'tax_included',
        tax_8_yen: 0,
        tax_10_yen: 0,
        points_used_yen: 300,
        coupon_yen: 0,
        store_confidence: 1,
        date_confidence: 1,
        total_confidence: 1,
      },
    ]).transactions[0]!;
    expect(t.reconcile?.status).toBe('ok');
    expect(reconcileReceipt(t.draft!).status).toBe('ok');
    expect(t.items.reduce((a, i) => a + i.amountYen, 0)).toBe(t.amountYen);
  });
});

describe('受け入れ基準5:記録開始から9日目の時点で、前月比較と月末予測が表示されない', () => {
  it('前月比較は「記録開始からN日」、月末予測は出ない', () => {
    const pace = paceComparison({
      today: TODAY,
      firstRecordedOn: '2026-09-21',
      lastMonthSameDay: '2026-08-29',
      dayOfMonth: 29,
      thisMonthToDateYen: 31542,
      lastMonthSameDayYen: 0,
    });
    expect(pace).toEqual({ kind: 'since_start', days: 9 });
    const recorded = countRecordedDays([
      '2026-09-21',
      '2026-09-22',
      '2026-09-25',
      '2026-09-27',
      '2026-09-29',
    ]);
    expect(canShowForecast(recorded)).toBe(false);
  });
});

describe('受け入れ基準6:予算0円のジャンルに「順調です」「1日0円まで」が表示されない', () => {
  it('予算なしはグレー・文言なし', () => {
    const g = planGuidance({
      periodStart: '2026-09-29',
      periodEnd: '2026-10-05',
      today: '2026-10-02',
      items: [
        { genreId: 'a', genreName: '外食', targetYen: 7000, spentYen: 1000 },
        { genreId: 'z', genreName: '酒', targetYen: 0, spentYen: 0 },
      ],
    });
    const z = g.genres.find((x) => x.genreId === 'z')!;
    expect(z.message).toBe('');
    expect(z.status).toBe('no_budget');
    expect(budgetState({ spentYen: 0, budgetYen: 0 })).toBe('none');
    expect([g.headline, ...g.actions, ...g.genres.map((x) => x.message)].join('')).not.toContain(
      '1日0円',
    );
  });
});

describe('受け入れ基準7:「残りN日」の表記が全画面で一致する', () => {
  it('目標の指針・期間表示・日数関数が同じ値', () => {
    for (const today of ['2026-09-29', '2026-10-03', '2026-10-06']) {
      const n = remainingDays('2026-09-29', '2026-10-06', today);
      const g = planGuidance({
        periodStart: '2026-09-29',
        periodEnd: '2026-10-06',
        today,
        items: [{ genreId: 'a', genreName: '外食', targetYen: 8000, spentYen: 0 }],
      });
      expect(g.remainingDays).toBe(n);
      expect(formatRemainingDays('2026-09-29', '2026-10-06', today)).toBe(`残り${n}日`);
    }
  });
});

describe('受け入れ基準8:レシート保存時に、目標の残り予算の変化が確認画面に出る', () => {
  it('保存前 → 保存後の残り予算(ジャンルごと)', () => {
    const snapshot = {
      range: { from: '2026-09-29', to: '2026-10-05' },
      genres: [{ genreId: 'dining', genreName: '外食', targetYen: 7900, spentYen: 5000 }],
    };
    const impact = goalImpact(snapshot, {
      occurredOn: TODAY,
      today: TODAY,
      kind: 'normal',
      deltas: [{ genreId: 'dining', amountYen: 1500 }],
    });
    expect(impact.rows[0]).toMatchObject({ beforeRemainingYen: 2900, afterRemainingYen: 1400 });
    expect(budgetSpokenLabel('外食', 5000, 7900)).toBe(
      '外食、7,900円のうち5,000円使用、残り2,900円',
    );
  });
});
