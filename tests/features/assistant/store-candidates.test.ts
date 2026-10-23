import { describe, expect, it } from 'vitest';

import { planToolCall, type PlanContext } from '@/features/assistant/plan';
import {
  matchStores,
  summarizeStores,
  withStoreCandidates,
} from '@/features/assistant/store-candidates';
import type { Genre } from '@/features/genre/store';
import type { AppSettings } from '@/features/settings/store';
import type { StoredTransaction } from '@/features/transactions/types';
import { addDays, todayJst } from '@/lib/date';

/**
 * 「コンビニで500円」から、過去の記録でよく行くお店を当てる(ADR-107)。
 */

const today = todayJst();

const GENRES: Genre[] = [
  {
    id: 'g-food',
    name: '食料品',
    sortOrder: 0,
    budgetYen: null,
    showOnHome: true,
    forecastClosed: false,
  },
  {
    id: 'g-daily',
    name: '日用品',
    sortOrder: 1,
    budgetYen: null,
    showOnHome: true,
    forecastClosed: false,
  },
  {
    id: 'g-out',
    name: '外食',
    sortOrder: 2,
    budgetYen: null,
    showOnHome: true,
    forecastClosed: false,
  },
];

let seq = 0;
function tx(
  description: string,
  daysAgo: number,
  genreId: string | null,
  amountYen = -500,
): StoredTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'a1',
    occurredOn: addDays(today, -daysAgo),
    description,
    merchantName: null,
    amountYen,
    paymentMethod: 'one_time',
    genreId,
    genreName: GENRES.find((g) => g.id === genreId)?.name ?? null,
    classifiedBy: 'manual',
    confidence: null,
    reviewStatus: 'auto_ok',
    mustPay: false,
    source: 'manual',
    fingerprint: `f${seq}`,
    batchId: null,
    sourceRef: null,
    memo: null,
  };
}

const HISTORY: StoredTransaction[] = [
  tx('セブン-イレブン 渋谷道玄坂店', 1, 'g-food'),
  tx('セブン-イレブン 渋谷道玄坂店', 3, 'g-food'),
  tx('セブンイレブン 渋谷道玄坂店', 5, 'g-daily'),
  tx('セブン-イレブン 新宿駅南口店', 9, 'g-food'),
  tx('ローソン 神泉町店', 2, 'g-daily'),
  tx('ローソン 神泉町店', 20, 'g-daily'),
  tx('ファミリーマート 道玄坂店', 30, 'g-food'),
  tx('スーパー玉出 天下茶屋店', 4, 'g-food'),
  tx('ライフ 渋谷店', 6, 'g-food'),
  tx('ライフ 渋谷店', 7, 'g-food'),
  tx('ライフ 渋谷店', 8, 'g-food'),
  tx('食料品', 1, 'g-food'), // カテゴリ名のままの記録はお店ではない
  tx('給料', 10, null, 250_000), // 収入は入れない
  tx('セブン-イレブン 未来店', -3, 'g-food'), // 先の予定は入れない
  tx('ローソン 昔の店', 400, 'g-food'), // 1年より前は入れない
];

const STORES = summarizeStores(HISTORY, today, GENRES);

const SETTINGS: AppSettings = {
  monthlySavingsTargetYen: 0,
  investmentRatioOfSavings: 0,
  isHighRiskUnlocked: false,
  highRiskAllocationRatio: 0,
  payday: 25,
  sideIncomeSavingsRatio: 0,
  aiEnabled: true,
  eveningCheckEnabled: true,
  eveningCheckAt: '21:00',
  receiptCheckLevel: 'normal',
};
const CTX: PlanContext = {
  genres: GENRES,
  settings: SETTINGS,
  transactions: [],
  goals: [],
  latestPlan: null,
  stores: STORES,
};

function proposeRecord(input: Record<string, unknown>) {
  const { change } = planToolCall('add_transaction', input, CTX);
  return withStoreCandidates(change, input, CTX, today);
}

describe('summarizeStores(よく使うお店)', () => {
  it('同じお店(表記ゆれを含む)をまとめ、回数の多い順。いちばん多いカテゴリを覚える', () => {
    const seven = STORES.find((s) => s.name.includes('渋谷道玄坂'));
    expect(seven).toMatchObject({ count: 3, genreName: '食料品', type: 'convenience' });
    expect(STORES[0]!.count).toBe(3);
  });

  it('カテゴリ名のままの記録・収入・先の予定・1年より前は入れない', () => {
    const names = STORES.map((s) => s.name);
    expect(names).not.toContain('食料品');
    expect(names).not.toContain('給料');
    expect(names.some((n) => n.includes('未来店') || n.includes('昔の店'))).toBe(false);
  });
});

describe('matchStores(言い方に当てはまるお店)', () => {
  it('「コンビニ」ならコンビニのお店(回数の多い順)', () => {
    expect(matchStores('コンビニ', STORES).map((s) => s.name)).toEqual([
      'セブン-イレブン 渋谷道玄坂店',
      'ローソン 神泉町店',
      'セブン-イレブン 新宿駅南口店',
      'ファミリーマート 道玄坂店',
    ]);
    expect(matchStores('駅前のコンビニ', STORES)).toHaveLength(4);
  });

  it('「セブン」なら同じチェーンの支店', () => {
    expect(matchStores('セブン', STORES).map((s) => s.name)).toEqual([
      'セブン-イレブン 渋谷道玄坂店',
      'セブン-イレブン 新宿駅南口店',
    ]);
  });

  it('「スーパー玉出」はお店の名前(スーパー全部にはしない)', () => {
    expect(matchStores('スーパー玉出', STORES).map((s) => s.name)).toEqual([
      'スーパー玉出 天下茶屋店',
    ]);
    expect(matchStores('スーパー', STORES).map((s) => s.name)).toContain('ライフ 渋谷店');
  });

  it('AIが選んだお店を先に。一覧に無い名前は捨てる', () => {
    const names = matchStores('', STORES, ['ローソン 神泉町店', '存在しない店']).map((s) => s.name);
    expect(names).toEqual(['ローソン 神泉町店']);
  });
});

describe('withStoreCandidates(記録の案にお店の候補をつける)', () => {
  it('「コンビニで500円」:いちばん行くコンビニで案を作り、ほかのコンビニと元の言い方をボタンに', () => {
    const change = proposeRecord({ occurred_on: today, amount_yen: 500, store_name: 'コンビニ' });
    expect(change.target).toBe('セブン-イレブン 渋谷道玄坂店');
    expect(change.detail).toContain('食料品');
    expect(change.input).toMatchObject({
      store_name: 'セブン-イレブン 渋谷道玄坂店',
      genre_name: '食料品',
    });
    expect(change.candidates?.map((c) => c.name)).toEqual([
      'セブン-イレブン 渋谷道玄坂店',
      'ローソン 神泉町店',
      'セブン-イレブン 新宿駅南口店',
      'ファミリーマート 道玄坂店',
      'コンビニ',
    ]);
  });

  it('AIがよく行くお店そのものを選んでいれば、それを先頭のまま残す', () => {
    const input = {
      occurred_on: today,
      amount_yen: 500,
      store_name: 'ローソン 神泉町店',
      genre_name: '日用品',
      store_candidates: [
        'セブン-イレブン 渋谷道玄坂店',
        'ファミリーマート 道玄坂店',
        'ライフ 渋谷店',
        'セブン-イレブン 新宿駅南口店',
      ],
    };
    const change = proposeRecord(input);
    expect(change.target).toBe('ローソン 神泉町店');
    expect(change.candidates?.[0]?.name).toBe('ローソン 神泉町店');
    expect(change.candidates).toHaveLength(4);
  });

  it('当てはまるお店が無い・収入なら、そのまま(ボタンも出さない)', () => {
    const fresh = proposeRecord({
      occurred_on: today,
      amount_yen: 300,
      store_name: 'ニューデイズ',
    });
    expect(fresh.target).toBe('ニューデイズ');
    expect(fresh.candidates).toBeUndefined();
    const income = proposeRecord({
      occurred_on: today,
      amount_yen: 1000,
      kind: 'income',
      store_name: 'コンビニ',
    });
    expect(income.candidates).toBeUndefined();
  });

  it('ボタンで選んだ名前は、反映するときにサーバーがそのまま確かめる(選び直しを戻さない)', () => {
    const change = proposeRecord({ occurred_on: today, amount_yen: 500, store_name: 'コンビニ' });
    const back = planToolCall('add_transaction', { ...change.input, store_name: 'コンビニ' }, CTX);
    expect(back.change.target).toBe('コンビニ');
  });
});
