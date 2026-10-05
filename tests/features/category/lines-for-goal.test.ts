import { describe, expect, it } from 'vitest';

import {
  buildCategoryLines,
  scheduledYen,
  type CategoryTx,
} from '../../../src/features/category/model';
import { categoryAllowanceYen, linesForGoal } from '../../../src/features/category/pace';
import { ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-10-05';
const GOAL = { from: '2026-10-07', to: '2026-11-05' };
const tx = (id: string, occurredOn: string, yen: number): CategoryTx => ({
  ...ledgerTx({ id, occurredOn, genreId: 'food', amountYen: -yen }),
  items: [],
});
const lines = buildCategoryLines(
  [
    tx('a', '2026-10-01', 500), // 実績(目標の前)
    tx('b', '2026-10-06', 1000), // 予定(目標の前)
    tx('c', '2026-10-20', 2000), // 予定(目標の中)
    tx('d', '2026-10-31', 4000), // 予定(目標の中)
  ],
  'food',
  { from: '2026-10-01', to: '2026-10-31' },
  TODAY,
);

describe('linesForGoal(目標と照らす行)', () => {
  it('目標の期間の外にある予定は外す。実績は残す', () => {
    const kept = linesForGoal(lines, GOAL);
    expect(kept.map((l) => l.txId)).toEqual(['a', 'c', 'd']);
  });

  it('予定の合計は、目標の期間の分だけになる(全部足さない)', () => {
    expect(scheduledYen(lines)).toBe(7000);
    expect(scheduledYen(linesForGoal(lines, GOAL))).toBe(6000);
  });

  it('1日の目安は、目標の期間の予定だけを予算から引く', () => {
    const allowance = categoryAllowanceYen({
      budgetYen: 36000,
      scheduledYen: scheduledYen(linesForGoal(lines, GOAL)),
      lines: linesForGoal(lines, GOAL),
      goalRange: GOAL,
      today: TODAY,
    });
    // 期間は30日。(36,000 − 予定6,000 − 目標前の実績は期間に入らない0)÷ 30日 = 1,000
    expect(allowance).toBe(1000);
  });
});
