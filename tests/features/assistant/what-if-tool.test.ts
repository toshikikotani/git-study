import { describe, expect, it, vi } from 'vitest';

const simulate = vi.fn();
vi.mock('@/features/forecast/what-if-spend', () => ({
  MAX_WHAT_IF_YEN: 1_000_000,
  simulateTodaySpends: (...args: unknown[]) => simulate(...args),
}));

import { simulateSpendCard, whatIfToolText } from '@/features/assistant/what-if-tool';
import { ChatToolError } from '@/lib/chat-tools';

/** AIの simulate_spend(ADR-108):ホームと同じ予測で前 → 後を出し、カードとモデルへの文にする。 */

const GENRES = [
  {
    id: 'g-out',
    name: '外食',
    sortOrder: 0,
    budgetYen: null,
    showOnHome: true,
    forecastClosed: false,
  },
];

describe('simulateSpendCard', () => {
  it('額とジャンルで計算し、前 → 後の行・ひとこと・時点をカードにする', async () => {
    simulate.mockResolvedValue({
      budgetYen: 172000,
      monthlySavingsTargetYen: 100000,
      base: {
        amountYen: 0,
        landingYen: 206000,
        probWithinBudget: 0.01,
        tomorrowYen: 1320,
        monthEndYen: 83000,
      },
      options: [
        {
          amountYen: 3000,
          landingYen: 209000,
          probWithinBudget: 0.004,
          tomorrowYen: 1160,
          monthEndYen: 80000,
        },
      ],
      computedAt: '10/17 12:35',
    });
    const card = await simulateSpendCard(
      { amount_yen: 3000, genre_name: '外食' },
      { genres: GENRES },
    );
    expect(simulate).toHaveBeenCalledWith([3000], { id: 'g-out', name: '外食' });
    expect(card.rows.map((r) => r.label)).toEqual([
      '着地見込み',
      '目標内の確率',
      '明日からの目安',
      '月末の貯金',
    ]);
    expect(card.rows[0]).toEqual({
      label: '着地見込み',
      before: '約20.6万円',
      after: '約20.9万円',
    });
    expect(card.computedAt).toBe('10/17 12:35');
    const text = whatIfToolText(card);
    expect(text).toContain('今日あと3,000円使ったら(アプリの見通し、10/17 12:35時点)');
    expect(text).toContain('- 明日からの目安: 1,320円 → 1,160円');
  });

  it('額が整数円でない・大きすぎる・知らないジャンルは受け付けない', async () => {
    await expect(simulateSpendCard({ amount_yen: 0 }, { genres: GENRES })).rejects.toThrow(
      ChatToolError,
    );
    await expect(simulateSpendCard({ amount_yen: 2_000_000 }, { genres: GENRES })).rejects.toThrow(
      ChatToolError,
    );
    await expect(
      simulateSpendCard({ amount_yen: 500, genre_name: '存在しない' }, { genres: GENRES }),
    ).rejects.toThrow(ChatToolError);
  });
});
