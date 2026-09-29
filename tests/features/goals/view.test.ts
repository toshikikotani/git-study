import { describe, expect, it } from 'vitest';

import { buildGoalView, dayStatus } from '@/features/goals/view';
import { toLedgerEntries } from '@/features/spending/views';
import { ledgerTx } from '../../helpers/ledger';

const plan = {
  id: 'p1',
  periodStart: '2026-09-29',
  periodEnd: '2026-10-06', // 8日間
  items: [
    { genreId: 'dining', genreName: '外食', targetYen: 8000 },
    { genreId: 'food', genreName: '食料品', targetYen: 16000 },
    { genreId: 'liquor', genreName: '酒', targetYen: 0 },
  ],
};
const names = new Map([
  ['dining', '外食'],
  ['food', '食料品'],
  ['liquor', '酒'],
  ['event', '発表会'],
]);

describe('buildGoalView(目標の表示)', () => {
  const txs = [
    ledgerTx({ id: 'a', occurredOn: '2026-09-29', genreId: 'dining', amountYen: -2600 }),
    ledgerTx({ id: 'b', occurredOn: '2026-09-29', genreId: 'liquor', amountYen: -1200 }),
    // 9/29 に、10/3 の発表会を特別費・予定として登録
    ledgerTx({
      id: 'ev',
      occurredOn: '2026-10-03',
      genreId: 'event',
      amountYen: -26540,
      kind: 'special',
      status: 'scheduled',
    }),
    ledgerTx({ id: 'u', occurredOn: '2026-09-29', genreId: null, amountYen: -700 }),
  ];
  const view = buildGoalView({
    plan,
    entries: toLedgerEntries(txs),
    genreNames: names,
    today: '2026-09-29',
  });

  it('10/3 の特別費・予定は、実績にも見込みにも入らない(受け入れ基準2)', () => {
    expect(view.guidance.spentYen).toBe(2600);
    expect(view.guidance.showProjection).toBe(false);
    expect(view.guidance.projectedYen).toBeNull();
    // 256,336円のような破綻した見込みは出さない
    expect(view.guidance.headline).not.toMatch(/\d{3},\d{3}円/);
    expect(view.guidance.scheduledYen).toBe(26540);
    expect(view.guidance.specialYen).toBe(0);
  });

  it('残り日数・今日使える額(今日を含む)', () => {
    expect(view.guidance.remainingDays).toBe(8);
    // 目標 24,000円のうち今日より前の実績は 0 → 24,000 ÷ 8 = 3,000円/日 → 今日 2,600円使用で残り 400円
    expect(view.guidance.todayAllowanceYen).toBe(400);
    expect(view.dailyAllowanceYen).toBe(3000);
  });

  it('予算0円・目標外のジャンルと未分類は「予算なし」に分け、目標の合計に入れない', () => {
    expect(view.noBudget.map((r) => [r.genreName, r.spentYen])).toEqual([
      ['酒', 1200],
      ['未分類', 700],
    ]);
    expect(view.guidance.targetYen).toBe(24000);
    expect(view.breakdown.filter((r) => r.targetYen === null).map((r) => r.genreName)).toEqual([
      '酒',
      '未分類',
    ]);
    expect(view.uncategorizedYen).toBe(700);
  });

  it('期間中は振り返りを出さない', () => {
    expect(view.active).toBe(true);
    expect(view.review).toBeNull();
  });

  it('期間が終わると、ジャンルごとの目標と実績の振り返りが出る', () => {
    const ended = buildGoalView({
      plan,
      entries: toLedgerEntries([
        ledgerTx({ id: 'a', occurredOn: '2026-10-01', genreId: 'dining', amountYen: -9000 }),
        ledgerTx({ id: 'b', occurredOn: '2026-10-02', genreId: 'food', amountYen: -12000 }),
      ]),
      genreNames: names,
      today: '2026-10-08',
    });
    expect(ended.ended).toBe(true);
    expect(ended.review?.rows.map((r) => [r.genreName, r.targetYen, r.actualYen])).toEqual([
      ['外食', 8000, 9000],
      ['食料品', 16000, 12000],
    ]);
    expect(ended.review?.reviewGenre?.genreName).toBe('外食');
  });
});

describe('dayStatus(カレンダーの点)', () => {
  it('1日の目安に対して 余裕/注意/超過。目安が無ければ点を付けない', () => {
    expect(dayStatus(1000, 3000)).toBe('ok');
    expect(dayStatus(2600, 3000)).toBe('caution');
    expect(dayStatus(3500, 3000)).toBe('over');
    expect(dayStatus(3500, null)).toBeNull();
  });
});
