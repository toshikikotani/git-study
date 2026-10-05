import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockClient, type MockResult } from '../../helpers/supabase-mock';

let tables: Record<string, MockResult | (() => MockResult)> = {};
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...mockClient(tables),
    auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) },
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../../app/(app)/plan/actions', () => ({
  savePlanAction: vi.fn(),
  suggestPlanAction: vi.fn(),
  planLandingAction: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));

import { PlanBuilder } from '../../../app/(app)/plan/plan-builder';
import { savePlan } from '@/features/spending-plan/store';

const existing = [
  {
    id: 'a',
    period_start: '2026-09-29',
    period_end: '2026-10-06',
    created_at: '2026-09-29T00:00:00Z',
  },
];

beforeEach(() => {
  tables = { spending_plans: { data: existing, error: null } };
});

describe('目標の予約と重複禁止(受け入れ基準4)', () => {
  it('進行中の目標と期間が重なる目標は保存できない(理由つき)', async () => {
    await expect(
      savePlan({
        periodStart: '2026-10-04',
        periodEnd: '2026-10-10',
        stepPercent: 10,
        items: [{ genreId: 'g', targetYen: 1000, aiSuggestedYen: null, reason: null }],
      }),
    ).rejects.toThrow('重なっています');
  });

  it('終了日の翌日からの予約は、重複の判定を通る', async () => {
    tables = {
      spending_plans: { data: existing, error: null },
      spending_plan_items: { data: [], error: null },
    };
    // 重複の判定を通ったあと、後続の insert は簡易モックのため別の理由で失敗しうるが、重複の理由では失敗しない
    await savePlan({
      periodStart: '2026-10-07',
      periodEnd: '2026-10-13',
      stepPercent: 10,
      items: [{ genreId: 'g', targetYen: 1000, aiSuggestedYen: null, reason: null }],
    }).catch((e: Error) => expect(e.message).not.toContain('重なっています'));
  });
});

describe('PlanBuilder(サーバー描画)', () => {
  const props = {
    today: '2026-09-29',
    payday: 25,
    ranges: [{ id: 'a', periodStart: '2026-09-29', periodEnd: '2026-10-06' }],
  };

  it('進行中の目標があるあいだは「次の目標を予約」として折りたたみ、開始日は終了日の翌日', () => {
    const html = renderToString(h(PlanBuilder, { ...props, activeEnd: '2026-10-06' })).replace(
      /<!-- -->/g,
      '',
    );
    expect(html).toContain('次の目標を予約');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('2026年10月7日 〜 2026年10月13日');
    expect(html).not.toContain('重なっています');
  });

  it('進行中の目標が無ければ「新しい目標を立てる」を開いて出す', () => {
    const html = renderToString(h(PlanBuilder, { ...props, ranges: [], activeEnd: null })).replace(
      /<!-- -->/g,
      '',
    );
    expect(html).toContain('新しい目標を立てる');
    expect(html).toMatch(/<details[^>]*\sopen/);
  });

  it('期間が月をまたぐときは、月を縦に並べる', () => {
    const html = renderToString(h(PlanBuilder, { ...props, ranges: [], activeEnd: null })).replace(
      /<!-- -->/g,
      '',
    );
    expect(html).toContain('2026年9月');
    expect(html).toContain('2026年10月');
  });
});
