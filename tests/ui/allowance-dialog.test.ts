import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AllowanceExplainBody, carefulSentence } from '../../app/(app)/_home/allowance-dialog';
import { computeDailyLimit } from '@/features/forecast/daily-limit';

const visible = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

/**
 * なぜこの額？(デザイン v3-9「簡単版」、ADR-109)。数字はデザインのもの:目標 171,781円、昨日までに
 * 136,708円、予定 6,000円、今日 10,170円、土曜(休日)、残り20日(休日7・平日13)、確率1%。
 */
const today = computeDailyLimit({
  leftBudgetYen: 29073,
  remainingDayOffs: 7,
  remainingWeekdays: 13,
  dayOffMedianYen: 6153,
  weekdayMedianYen: 2725,
  probWithinBudget: 0.01,
  todayIsDayOff: true,
});
const tomorrow = computeDailyLimit({
  leftBudgetYen: 29073 - 10170,
  remainingDayOffs: 6,
  remainingWeekdays: 13,
  dayOffMedianYen: 6153,
  weekdayMedianYen: 2725,
  probWithinBudget: 0.01,
  todayIsDayOff: true,
});
const days = Array.from({ length: 19 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 18 + i));
  const date = d.toISOString().slice(0, 10);
  const holiday = date === '2026-11-03';
  return { date, dayOff: holiday || d.getUTCDay() === 0 || d.getUTCDay() === 6, holiday };
});

const text = visible(
  renderToString(
    h(AllowanceExplainBody, {
      explain: {
        budgetYen: 171781,
        spentYen: 136708 + 10170,
        spentTodayYen: 10170,
        remainingDays: 20,
        capYen: today.todayLimitYen,
        scheduledYen: 6000,
        fixedYen: 0,
        probWithinBudget: 0.01,
        dailyLimit: today,
        tomorrowLimit: tomorrow,
        today: '2026-10-17',
        days,
      },
      onClose: () => {},
    }),
  ),
);

describe('なぜこの額？(簡単版)', () => {
  it('今日の目安と曜日、今日使った額と、こえた額', () => {
    expect(text).toContain('今日の目安 土曜 · 休日');
    expect(text).toContain('1,151 円');
    expect(text).toContain('今日使った額 10,170円');
    expect(text).toContain('9,019円 こえ');
  });

  it('こうやって決めています:目標の残り → 残りの日に分ける → 控えめにする', () => {
    expect(text).toContain('目標の残り 29,073円');
    expect(text).toContain('目標 171,781 − 昨日までに使った 136,708 − 予定 6,000');
    expect(text).toContain('残り20日に分ける');
    expect(text).toContain('休日 2,279円');
    expect(text).toContain('平日 1,009円');
    expect(text).toContain(
      '休日はいつも平日の約2.3倍使うので、多めに分けます（休日7日・平日13日）',
    );
    expect(text).toContain('控えめにする');
    expect(text).toContain('目標内に収まる確率が1%と低いので、約半分にしています');
  });

  it('こえた分は明日からに回る:明日から19日の目安(休日・平日)と日ごとの棒', () => {
    expect(text).toContain('こえた分は、明日からに回ります');
    expect(text).toContain('明日から19日の目安 · 休日 約810円 · 平日 約360円');
    expect(text).toContain('祝');
    expect(text).toContain('11/1');
    expect(text).toContain('計算式を見る');
  });
});

describe('carefulSentence', () => {
  it('確率が低いほど控えめにした理由を書く', () => {
    expect(carefulSentence(0.01, 0.505)).toBe(
      '目標内に収まる確率が1%と低いので、約半分にしています',
    );
    expect(carefulSentence(0.3, 0.65)).toBe('目標内に収まる確率が30%と低めなので、65%にしています');
    expect(carefulSentence(0.9, 0.95)).toBe(
      '目標内に収まる確率が90%なので、少し控えめ(95%)にしています',
    );
  });
});
