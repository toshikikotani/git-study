import { beforeEach, describe, expect, it, vi } from 'vitest';

import { richTransactions } from '../../../scripts/forecast-eval/scenarios';
import { fakeSupabase, type FakeTables } from '../../helpers/fake-supabase';

let current = fakeSupabase({});
vi.mock('next/cache', () => ({
  // Next の実行環境が無いので、キャッシュは素通し(関数をそのまま返す)。
  unstable_cache: (fn: () => unknown) => fn,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => current.client }));

import { loadForecast, topSpendsOn } from '@/features/forecast/load';

// 過去の月での検証(半減期の選択を含む)が数秒かかる。
vi.setConfig({ testTimeout: 60_000 });

const TODAY = new Date('2026-09-30T03:00:00Z'); // JST 2026-09-30 12:00

function tables(): FakeTables {
  const rich = richTransactions();
  return {
    genres: [
      { id: 'dining', name: '外食', budget_yen: null, sort_order: 1 },
      { id: 'conv', name: 'コンビニ', budget_yen: null, sort_order: 2 },
      { id: 'transit', name: '交通費', budget_yen: null, sort_order: 3 },
      { id: 'hobby', name: '娯楽・趣味', budget_yen: null, sort_order: 4 },
      { id: 'grocery', name: '食料品', budget_yen: null, sort_order: 5 },
      { id: 'medical', name: '医療', budget_yen: null, sort_order: 6 },
    ],
    app_settings: [{ user_id: 'user-1', payday: 25, ai_enabled: true }],
    transactions: rich.map((t, i) => ({
      id: `t${i}`,
      occurred_on: t.occurredOn,
      description: t.description,
      merchant_name: t.merchantName,
      amount_yen: t.amountYen,
      genre_id: t.genreId,
      is_transfer: false,
      review_status: 'auto_ok',
      account_id: 'a',
      payment_method: 'cash',
      must_pay: false,
      note: null,
      import_batch_id: null,
      kind: 'normal',
      branch_name: null,
      reconcile_diff_yen: null,
    })),
  };
}

beforeEach(() => {
  current = fakeSupabase(tables());
});

describe('loadForecast(Supabase の読み込みを通した予測)', () => {
  it('1,000行を超える履歴をページを分けて読み、今月の着地を出す', async () => {
    const view = await loadForecast({
      period: { from: '2026-09-01', to: '2026-09-30' },
      now: TODAY,
    });
    expect(tables().transactions!.length).toBeGreaterThan(2000);
    expect(view.forecast.dataDays).toBeGreaterThan(300);
    expect(view.forecast.status).toBe('ready');
    expect(view.forecast.seasonal.active).toBe(true);
    expect(view.forecast.total.p50).toBeGreaterThan(0);
    expect(view.verification).not.toBeNull();
  });

  it('給料日の設定を予測に使い、履歴の学習に過去2年を使う', async () => {
    const view = await loadForecast({
      period: { from: '2026-10-01', to: '2026-10-31' },
      now: TODAY,
    });
    expect(view.forecast.path.length).toBeGreaterThan(0);
    expect(view.forecast.visits.merchants.some((m) => m.label === 'スーパーさくら')).toBe(true);
  });

  it('目標の期間・カテゴリ・目標額で、カテゴリごとの超過確率が出る', async () => {
    const view = await loadForecast({
      period: { from: '2026-10-07', to: '2026-11-05' },
      budgetYen: 60000,
      scope: { genreIds: new Set(['dining', 'hobby']), excludeSpecial: true },
      categoryTargets: [
        { categoryId: 'dining', categoryName: '外食', targetYen: 20000 },
        { categoryId: 'hobby', categoryName: '娯楽・趣味', targetYen: 40000 },
      ],
      now: TODAY,
    });
    const dining = view.forecast.byCategory.find((c) => c.categoryId === 'dining')!;
    expect(dining.exceedance).not.toBeNull();
    expect(view.forecast.probWithinBudget).not.toBeNull();
    // 明日からの目安(ADR-108):明日から期間の終わりまでに、今日の分を使ったあとの残りを配る。
    expect(view.tomorrowLimit).not.toBeNull();
    expect(view.tomorrowLimit!.todayLimitYen).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(view.todayTopSpends)).toBe(true);
  });

  it('明細が無い人でも、エラーにならない', async () => {
    current = fakeSupabase({ genres: [], transactions: [] });
    const view = await loadForecast({
      period: { from: '2026-09-01', to: '2026-09-30' },
      now: TODAY,
    });
    expect(view.forecast.total.p50).toBe(0);
    expect(view.verification).toBeNull();
  });

  it('kind 列がまだ無い本番でも、列を外して読み直す', async () => {
    const t = tables();
    // kind 列を持たない行(列が無い DB)。select に kind を含めるとエラーにする。
    t.transactions = t.transactions!.map((row) => {
      const copy = { ...row };
      delete copy.kind;
      return copy;
    });
    current = fakeSupabase(t);
    const original = current.client.from;
    current.client.from = ((table: string) => {
      const b = original(table) as Record<string, (...a: unknown[]) => unknown>;
      if (table !== 'transactions') return b;
      const select = b.select!;
      b.select = (cols: unknown) => {
        if (typeof cols === 'string' && cols.includes('kind')) {
          return {
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve({
                data: null,
                error: { code: '42703', message: 'column transactions.kind does not exist' },
              }).then(resolve),
            gte: () => b,
            lte: () => b,
            order: () => b,
            range: () => b,
            limit: () => b,
          };
        }
        return select(cols);
      };
      return b;
    }) as typeof current.client.from;
    const view = await loadForecast({
      period: { from: '2026-09-01', to: '2026-09-30' },
      now: TODAY,
    });
    expect(view.forecast.dataDays).toBeGreaterThan(300);
  });
});

describe('topSpendsOn(今日の目安の説明に使う、今日の大きい支出、ADR-108)', () => {
  const row = (description: string, amountYen: number, extra: Record<string, unknown> = {}) => ({
    occurredOn: '2026-10-17',
    genreId: 'dining',
    genreName: '外食',
    amountYen,
    status: 'actual' as const,
    kind: 'normal' as const,
    isTransfer: false,
    reviewStatus: 'auto_ok' as const,
    needsInput: false,
    merchantName: null,
    description,
    ...extra,
  });

  it('その日の支出を大きい順に2つ。振替・予定・ほかの日・範囲の外は入れない', () => {
    const rows = [
      row('コンビニ', -500),
      row('同窓会', -5000),
      row('ガソリン', -2000, { merchantName: 'スーパーセルフ熊谷SS' }),
      row('振替', -9000, { isTransfer: true }),
      row('ライブ', -6000, { status: 'scheduled' }),
      row('昨日', -8000, { occurredOn: '2026-10-16' }),
      row('食料品', -7000, { genreId: 'grocery' }),
    ];
    expect(topSpendsOn(rows, '2026-10-17', { genreIds: new Set(['dining']) })).toEqual([
      { name: '同窓会', amountYen: 5000 },
      { name: 'スーパーセルフ熊谷SS', amountYen: 2000 },
    ]);
  });
});
