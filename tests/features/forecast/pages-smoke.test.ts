import { createElement as h } from 'react';
import { PassThrough } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { richTransactions } from '../../../scripts/forecast-eval/scenarios';
import { fakeSupabase } from '../../helpers/fake-supabase';

const rich = richTransactions();
const tables: Record<string, Record<string, unknown>[]> = {
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
};
const failures: Record<string, { code?: string; message: string }> = {};
const fake = fakeSupabase(tables, { id: 'user-1' }, failures);

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

/** Suspense の中の非同期コンポーネントも待って描画する。描画中の例外は集めて、あれば失敗にする。 */
type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function render(
  load: () => Promise<{ default: (props: PageProps) => Promise<React.ReactElement> }>,
  searchParams: Record<string, string> = {},
) {
  const page = await load();
  const element = await page.default({ searchParams: Promise.resolve(searchParams) });
  const errors: unknown[] = [];
  const html = await new Promise<string>((resolve, reject) => {
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c: Buffer) => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    const stream = renderToPipeableStream(element, {
      onError: (error) => {
        errors.push(error);
      },
      onAllReady: () => stream.pipe(sink),
      onShellError: reject,
    });
  });
  if (errors.length > 0) throw errors[0];
  return html;
}

describe('主要ページがサーバー描画でエラーにならない(Supabase を代用)', () => {
  it('レポート', async () => {
    const html = (await render(() => import('../../../app/(app)/reports/page'))).replace(
      /<!-- -->/g,
      '',
    );
    expect(html).toContain('着地');
    // どの範囲の数字かを、画面の上に名前で出す。目標があれば「ぜんぶ」へ切り替えられる。
    expect(html).toContain('範囲:目標のジャンル');
    expect(html).toContain('ぜんぶ');
    expect(html).toContain('今月(すべての支出)');
  }, 60000);

  it('レポート(全部)', async () => {
    const html = (
      await render(() => import('../../../app/(app)/reports/page'), { scope: 'all' })
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('範囲:今月のすべての支出');
  }, 60000);

  it('目標', async () => {
    const html = await render(() => import('../../../app/(app)/plan/page'));
    expect(html.length).toBeGreaterThan(100);
  }, 60000);

  const planRow = () => tables.spending_plans![0]!;
  const original = { start: '2026-09-25', end: '2026-10-24' };
  const variants: [string, () => void][] = [
    [
      'これから始まる目標(10/7〜11/5)',
      () => {
        planRow().period_start = '2026-10-07';
        planRow().period_end = '2026-11-05';
      },
    ],
    [
      '終わった目標',
      () => {
        planRow().period_start = '2026-09-01';
        planRow().period_end = '2026-09-30';
      },
    ],
    [
      '目標0円のジャンルがある',
      () => {
        tables.spending_plan_items![1]!.target_yen = 0;
      },
    ],
    [
      '存在しないジャンルの目標行がある',
      () => {
        tables.spending_plan_items![1]!.genre_id = 'gone';
      },
    ],
    [
      '予測を止めたジャンルがある',
      () => {
        tables.genres![3]!.forecast_closed = true;
      },
    ],
  ];
  for (const [name, apply] of variants) {
    it(`目標:${name}`, async () => {
      planRow().period_start = original.start;
      planRow().period_end = original.end;
      apply();
      const html = await render(() => import('../../../app/(app)/plan/page'));
      expect(html).toContain('今の目標');
    }, 60000);
  }

  it('目標:明細の読み込みが失敗しても、ページは落ちず、原因を見せる', async () => {
    planRow().period_start = original.start;
    planRow().period_end = original.end;
    failures.transactions = {
      code: '57014',
      message: 'canceling statement due to statement timeout',
    };
    try {
      const html = (await render(() => import('../../../app/(app)/plan/page'))).replace(
        /<!-- -->/g,
        '',
      );
      expect(html).toContain('今の目標を読み込めませんでした');
      expect(html).toContain('statement timeout');
      expect(html).toMatch(/新しい目標を立てる|次の目標を予約/);
    } finally {
      delete failures.transactions;
    }
  }, 60000);

  it('家計簿', async () => {
    const html = await render(() => import('../../../app/(app)/spending/page'));
    expect(html.length).toBeGreaterThan(100);
  }, 60000);
});
