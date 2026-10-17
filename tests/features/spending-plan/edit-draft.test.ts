import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  userId: 'u' as string | null,
  plans: [] as Record<string, unknown>[],
  items: [] as Record<string, unknown>[],
  writeCount: 0,
  failures: new Set<number>(),
  applyFailedWrite: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: db.userId ? { id: db.userId } : null },
        error: null,
      }),
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        update: (value: Record<string, unknown>) => {
          patch = value;
          return query;
        },
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        then(resolve: (value: unknown) => void) {
          const rows = (table === 'spending_plans' ? db.plans : db.items).filter((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value),
          );
          if (patch) {
            const fails = db.failures.has(++db.writeCount);
            if (!fails || db.applyFailedWrite) rows.forEach((row) => Object.assign(row, patch));
            resolve({ data: null, error: fails ? { message: 'connection lost' } : null });
          } else {
            resolve({ data: structuredClone(rows), error: null });
          }
        },
      };
      return query;
    },
  }),
}));

import { updatePlanDraft } from '@/features/spending-plan/edit-draft';
import { ADDED_FROM_SPENDING } from '@/features/spending-plan/markers';

const draft = {
  periodStart: '2026-10-02',
  periodEnd: '2026-10-16',
  items: [
    { genreId: 'a', targetYen: 5000 },
    { genreId: 'b', targetYen: 7000 },
  ],
};

beforeEach(() => {
  db.userId = 'u';
  db.writeCount = 0;
  db.failures = new Set();
  db.applyFailedWrite = false;
  db.plans = [{ id: 'p', user_id: 'u', period_start: '2026-10-01', period_end: '2026-10-15' }];
  db.items = [
    { plan_id: 'p', user_id: 'u', genre_id: 'a', target_yen: 3000, reason: ADDED_FROM_SPENDING },
    { plan_id: 'p', user_id: 'u', genre_id: 'b', target_yen: 4000, reason: 'AI提案' },
  ];
});

describe('目標の期間・総額・配分を一度で保存する', () => {
  it('期間と全配分を保存し、本人が変えた金額の自動追加マークを外す', async () => {
    await updatePlanDraft('p', draft);
    expect(db.plans[0]).toMatchObject({
      period_start: draft.periodStart,
      period_end: draft.periodEnd,
    });
    expect(db.items.map((i) => [i.target_yen, i.reason])).toEqual([
      [5000, null],
      [7000, 'AI提案'],
    ]);
  });

  it('配分の途中で失敗したら、期間と配分と自動追加マークを全て戻す', async () => {
    const before = structuredClone({ plans: db.plans, items: db.items });
    db.failures.add(3);
    await expect(updatePlanDraft('p', draft)).rejects.toThrow('変更前に戻しました');
    expect({ plans: db.plans, items: db.items }).toEqual(before);
  });

  it('通信エラーでも書き込み済みの可能性がある行を復元する', async () => {
    const before = structuredClone({ plans: db.plans, items: db.items });
    db.failures.add(1);
    db.applyFailedWrite = true;
    await expect(updatePlanDraft('p', draft)).rejects.toThrow('変更前に戻しました');
    expect({ plans: db.plans, items: db.items }).toEqual(before);
  });

  it('復元も失敗した場合は、一部が保存された可能性と確認操作を伝える', async () => {
    db.failures = new Set([3, 5]);
    await expect(updatePlanDraft('p', draft)).rejects.toThrow('一部の変更が保存されている可能性');
    expect(db.plans[0]).toMatchObject({ period_start: '2026-10-01' });
  });

  it('予約との重複は書き込む前に拒否する', async () => {
    db.plans.push({
      id: 'next',
      user_id: 'u',
      period_start: '2026-10-16',
      period_end: '2026-10-30',
    });
    await expect(updatePlanDraft('p', draft)).rejects.toThrow('重なっています');
    expect(db.writeCount).toBe(0);
  });

  it('不正な期間・金額・なくなったカテゴリは全て保存前に拒否する', async () => {
    await expect(updatePlanDraft('p', { ...draft, periodEnd: '2026-10-01' })).rejects.toThrow(
      '終了日',
    );
    await expect(
      updatePlanDraft('p', { ...draft, items: [{ genreId: 'a', targetYen: -1 }] }),
    ).rejects.toThrow('0円以上');
    await expect(
      updatePlanDraft('p', { ...draft, items: [{ genreId: 'unknown', targetYen: 1 }] }),
    ).rejects.toThrow('カテゴリが変更');
    expect(db.writeCount).toBe(0);
  });

  it('認証がなければ書き込まない', async () => {
    db.userId = null;
    await expect(updatePlanDraft('p', draft)).rejects.toThrow('ログイン状態');
    expect(db.writeCount).toBe(0);
  });
});
