import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase, type FakeTables } from '../helpers/fake-supabase';

const s = vi.hoisted(() => ({
  tables: {} as FakeTables,
  pushed: [] as unknown[],
  items: [] as unknown[],
  hour: 21,
}));

vi.mock('@/lib/supabase/admin', async () => {
  const { fakeSupabase: fake } = await import('../helpers/fake-supabase');
  return { createAdminClient: () => fake(s.tables).client };
});
vi.mock('@/lib/supabase/owner', () => ({
  findOwner: async () => ({
    user: { id: 'me', email: 'me@example.com', created_at: '' },
    error: null,
  }),
}));
vi.mock('@/features/today-check/store', () => ({ listTodayCheck: async () => s.items }));
vi.mock('@/lib/date', async (original) => ({
  ...(await original<typeof import('@/lib/date')>()),
  hourJst: () => s.hour,
  todayJst: () => '2026-10-21',
}));
vi.mock('@/lib/line', async (original) => ({
  ...(await original<typeof import('@/lib/line')>()),
  pushLineMessages: async (_t: string, _u: string, messages: unknown[]) => {
    s.pushed.push(...messages);
  },
}));
vi.mock('@/features/line/conversation', async () => ({
  checkMessage: (items: unknown[]) =>
    items.length === 0 ? null : { type: 'text', text: `${items.length}件` },
}));

import { POST } from '../../app/api/cron/evening-check/route';

const ME = 'U00000000000000000000000000000000';
const CRON = 'c'.repeat(40);

/** 夜の答え合わせ(v4-2、ADR-130)。0件の日は届かない・同じ日に二度送らない。 */

const call = () =>
  POST(
    new Request('https://example.test/api/cron/evening-check', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON}` },
    }),
  );

beforeEach(() => {
  process.env.CRON_SECRET = CRON;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 't'.repeat(60);
  process.env.LINE_USER_ID = ME;
  s.tables = {
    app_settings: [{ user_id: 'me', evening_check_enabled: true, evening_check_at: '21:00:00' }],
    job_runs: [],
  };
  s.pushed = [];
  s.items = [{ id: 'a' }, { id: 'b' }];
  s.hour = 21;
});

describe('夜の答え合わせ', () => {
  it('設定の時刻に、今日の片づけるものを送り、送ったことを残す', async () => {
    expect(await (await call()).json()).toEqual({ sent: 2 });
    expect(s.pushed).toEqual([{ type: 'text', text: '2件' }]);
    expect(s.tables.job_runs).toEqual([
      expect.objectContaining({
        job_name: 'evening_check',
        status: 'succeeded',
        items_processed: 2,
      }),
    ]);
  });

  it('0件の日は届かない', async () => {
    s.items = [];
    await call();
    expect(s.pushed).toEqual([]);
  });

  it('時刻でない・オフ・もう送った日は送らない', async () => {
    s.hour = 20;
    await call();
    s.hour = 21;
    s.tables.app_settings = [
      { user_id: 'me', evening_check_enabled: false, evening_check_at: '21:00:00' },
    ];
    await call();
    expect(s.pushed).toEqual([]);
    s.tables.app_settings = [
      { user_id: 'me', evening_check_enabled: true, evening_check_at: '21:00:00' },
    ];
    s.tables.job_runs = [
      {
        user_id: 'me',
        job_name: 'evening_check',
        status: 'succeeded',
        started_at: '2026-10-21T11:00:00.000Z',
      },
    ];
    await call();
    expect(s.pushed).toEqual([]);
  });

  it('合言葉が違えば断る', async () => {
    const response = await POST(
      new Request('https://example.test/api/cron/evening-check', {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
      }),
    );
    expect(response.status).toBe(401);
    expect(fakeSupabase).toBeDefined();
  });
});
