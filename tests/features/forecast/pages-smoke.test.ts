import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { richTransactions } from '../../../scripts/forecast-eval/scenarios';
import { fakeSupabase } from '../../helpers/fake-supabase';

const rich = richTransactions();
const fake = fakeSupabase({
  genres: [
    { id: 'dining', name: '外食', budget_yen: 30000, sort_order: 1, show_on_home: true },
    { id: 'conv', name: 'コンビニ', budget_yen: null, sort_order: 2, show_on_home: false },
    { id: 'transit', name: '交通費', budget_yen: null, sort_order: 3, show_on_home: false },
    { id: 'hobby', name: '娯楽・趣味', budget_yen: null, sort_order: 4, show_on_home: false },
    { id: 'grocery', name: '食料品', budget_yen: null, sort_order: 5, show_on_home: false },
    { id: 'medical', name: '医療', budget_yen: null, sort_order: 6, show_on_home: false },
  ],
  app_settings: [{ user_id: 'user-1', payday: 25, ai_enabled: true }],
  accounts: [{ id: 'a', name: '現金', kind: 'cash', purpose: 'living', user_id: 'user-1' }],
  spending_plans: [
    {
      id: 'p1',
      period_start: '2026-09-25',
      period_end: '2026-10-24',
      step_percent: 10,
      created_at: '2026-09-20T00:00:00Z',
    },
  ],
  spending_plan_items: [
    {
      id: 'i1',
      plan_id: 'p1',
      genre_id: 'dining',
      target_yen: 20000,
      ai_suggested_yen: null,
      reason: null,
    },
    {
      id: 'i2',
      plan_id: 'p1',
      genre_id: 'hobby',
      target_yen: 15000,
      ai_suggested_yen: null,
      reason: null,
    },
  ],
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
    status: 'actual',
  })),
});

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fake.client }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('notFound');
  },
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
  headers: async () => new Headers(),
}));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T03:00:00Z'));
});

async function render(load: () => Promise<{ default: () => Promise<React.ReactElement> }>) {
  const page = await load();
  const element = await page.default();
  return renderToString(element);
}

describe('主要ページがサーバー描画でエラーにならない(Supabase を代用)', () => {
  it('レポート', async () => {
    const html = await render(() => import('../../../app/(app)/reports/page'));
    expect(html).toContain('着地');
  }, 60000);

  it('目標', async () => {
    const html = await render(() => import('../../../app/(app)/plan/page'));
    expect(html.length).toBeGreaterThan(100);
  }, 60000);

  it('家計簿', async () => {
    const html = await render(() => import('../../../app/(app)/spending/page'));
    expect(html.length).toBeGreaterThan(100);
  }, 60000);
});
