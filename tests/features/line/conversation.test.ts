import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FakeTables } from '../../helpers/fake-supabase';

const s = vi.hoisted(() => ({
  tables: {} as FakeTables,
  imported: [] as unknown[],
  insertedId: '11111111-2222-3333-4444-555555555555' as string | null,
  turn: vi.fn(),
  simulate: vi.fn(),
  confirmSure: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/lib/supabase/server', async () => {
  const { fakeSupabase: fake } = await import('../../helpers/fake-supabase');
  return { createClient: async () => fake(s.tables, { id: 'me' }).client };
});
vi.mock('@/features/transactions/store', () => ({
  importTransactions: async (rows: { sourceRef: string }[]) => {
    s.imported.push(...rows);
    return {
      importedCount: s.insertedId ? 1 : 0,
      duplicateCount: s.insertedId ? 0 : 1,
      insertedTransactions: s.insertedId
        ? [{ id: s.insertedId, sourceRef: rows[0]!.sourceRef }]
        : [],
    };
  },
}));
vi.mock('@/features/transactions/store-genres', () => ({
  fetchStoreGenres: async () => [['ランチ', 'g-food']],
}));
vi.mock('@/features/genre/store', () => ({
  fetchQuickEntryGenres: async () => [
    { id: 'g-food', name: '外食' },
    { id: 'g-cafe', name: 'カフェ・飲料' },
  ],
}));
vi.mock('@/features/home/today-forecasts', () => ({
  loadTodayForecasts: async () => ({ goalView: { tomorrowLimit: { todayLimitYen: 2400 } } }),
}));
vi.mock('@/features/advisor/context', () => ({
  todayNumbersOf: () => ({
    allowance: { kind: 'left', capYen: 3000, spentYen: 1200, leftYen: 1800 },
  }),
}));
vi.mock('@/features/forecast/what-if-spend', () => ({
  simulateTodaySpends: (...args: unknown[]) => s.simulate(...args),
}));
vi.mock('@/features/assistant/turn', () => ({
  runAssistantTurn: (...args: unknown[]) => s.turn(...args),
}));
vi.mock('@/features/today-check/store', () => ({
  listTodayCheck: (...args: unknown[]) => s.list(...args),
  confirmSureTodayCheck: (...args: unknown[]) => s.confirmSure(...args),
}));

import { checkMessage, replyToPostback, replyToText } from '@/features/line/conversation';

/** LINE の会話(v4-2、ADR-130)。 */

const ctx = { messageId: 'msg-1', accountId: 'acc-1', appBaseUrl: 'https://kakeibo.example' };
const id = '11111111-2222-3333-4444-555555555555';
const genreId = '66666666-7777-8888-9999-000000000000';
type Text = {
  type: 'text';
  text: string;
  quickReply?: { items: { action: Record<string, string> }[] };
};
const first = (messages: unknown[]) => messages[0] as Text;
const buttons = (messages: unknown[]) =>
  first(messages).quickReply?.items.map((i) => i.action) ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  s.imported = [];
  s.insertedId = id;
  s.tables = {
    transactions: [
      {
        id,
        user_id: 'me',
        description: 'ランチ',
        merchant_name: 'ランチ',
        amount_yen: -1200,
        source_ref: 'line-text-msg-1',
      },
      {
        id: '99999999-2222-3333-4444-555555555555',
        user_id: 'me',
        description: 'カード',
        merchant_name: null,
        amount_yen: -500,
        source_ref: null,
      },
    ],
    genres: [{ id: genreId, user_id: 'me', name: '日用品' }],
    genre_memory: [],
    app_settings: [],
  };
  s.simulate.mockResolvedValue({
    computedAt: '10/21 20:00',
    base: { landingYen: 200000, probWithinBudget: 0.8, tomorrowYen: 3000, savingsYen: 50000 },
    options: [{ landingYen: 203000, probWithinBudget: 0.7, tomorrowYen: 2700, savingsYen: 47000 }],
    budgetYen: 210000,
  });
});

describe('「ランチ 1200」で1件入り、「取り消す」で消える', () => {
  it('今日の支出として記録し、今日の目安との差と、取り消す・カテゴリを変えるのボタンを返す', async () => {
    const messages = await replyToText('ランチ 1200', ctx);
    expect(s.imported).toEqual([
      expect.objectContaining({
        description: 'ランチ',
        amountYen: -1200,
        genreId: 'g-food',
        source: 'manual',
        sourceRef: 'line-text-msg-1',
        reviewStatus: 'confirmed',
      }),
    ]);
    expect(first(messages).text).toContain('記録しました:ランチ 1,200円(外食)');
    expect(first(messages).text).toContain('今日あと 1,800円 使えます');
    expect(buttons(messages).map((b) => b.label)).toEqual(['取り消す', 'カテゴリを変える']);
  });

  it('「取り消す」で、その記録を消す。LINE の文字から入れた記録だけが消せる', async () => {
    const [undo] = buttons(await replyToText('ランチ 1200', ctx));
    const reply = await replyToPostback(undo!.data!, ctx);
    expect(first(reply).text).toContain('取り消しました');
    expect(s.tables.transactions!.some((r) => r.id === id)).toBe(false);

    const other = await replyToPostback('a=undo&id=99999999-2222-3333-4444-555555555555', ctx);
    expect(first(other).text).toContain('LINE からは取り消せません');
    expect(s.tables.transactions).toHaveLength(1);
  });

  it('カテゴリに自信がなければ、夜の答え合わせに回す', async () => {
    await replyToText('ABC商会 800', ctx);
    expect(s.imported).toEqual([
      expect.objectContaining({ genreId: null, reviewStatus: 'pending' }),
    ]);
  });

  it('カテゴリを変える:本人のカテゴリだけ。次から同じ言葉はそのカテゴリに', async () => {
    const reply = await replyToPostback(`a=set_genre&id=${id}&g=${genreId}`, ctx);
    expect(first(reply).text).toContain('日用品にしました');
    expect(s.tables.transactions!.find((r) => r.id === id)).toMatchObject({
      genre_id: genreId,
      review_status: 'corrected',
    });
    expect(s.tables.genre_memory).toEqual([
      expect.objectContaining({ store_key: 'ランチ', genre_id: genreId, pinned: true }),
    ]);
    const bad = await replyToPostback(
      `a=set_genre&id=${id}&g=${'12345678-1234-1234-1234-123456789012'}`,
      ctx,
    );
    expect(first(bad).text).toContain('見つかりませんでした');
  });

  it('同じ日に同じ内容がもうあれば、入れずにそう伝える', async () => {
    s.insertedId = null;
    const reply = await replyToText('ランチ 1200', ctx);
    expect(first(reply).text).toContain('入れませんでした');
  });
});

describe('質問', () => {
  it('今日あといくら:今日の目安と明日からの目安', async () => {
    const text = first(await replyToText('今日あといくら', ctx)).text;
    expect(text).toContain('今日あと 1,800円 使えます(目安 3,000円・使った 1,200円)');
    expect(text).toContain('明日からの目安:1日 2,400円');
  });

  it('あと3000円使っていい？:アプリの「もし使ったら」と同じ計算(simulateTodaySpends)で答える', async () => {
    const messages = await replyToText('あと3000円使っていい？', ctx);
    expect(s.simulate).toHaveBeenCalledWith([3000], null);
    expect(first(messages).text).toContain('今日あと3,000円使ったら');
    expect(buttons(messages).map((b) => b.label)).toEqual(['予定に入れる', 'やめておく']);
  });

  it('それ以外はAIタブと同じように答え、記録や変更はしない(アプリで確かめる)', async () => {
    s.turn.mockResolvedValue({
      ok: true,
      reply: {
        reply: '外食が多めです。',
        proposal: { changes: [{ target: '設定', detail: '給料日 25日 → 20日' }] },
        question: null,
        links: [{ href: '/reports', label: '分析 › 目標' }],
      },
    });
    const messages = await replyToText('今月どう？', ctx);
    expect(s.turn).toHaveBeenCalledWith([{ role: 'user', content: '今月どう？' }]);
    expect(first(messages).text).toContain('外食が多めです。');
    expect(first(messages).text).toContain('LINE からはまだ反映しません');
    expect(s.imported).toEqual([]);
    expect(buttons(messages)).toEqual([
      { type: 'uri', label: 'アプリのAIで確かめる', uri: 'https://kakeibo.example/assistant' },
      { type: 'uri', label: '分析 › 目標', uri: 'https://kakeibo.example/reports' },
    ]);
  });
});

describe('答え合わせ', () => {
  const item = (over: Record<string, unknown>) => ({
    id: 'x',
    storeName: 'まいばすけっと',
    amountYen: 580,
    genreName: '食料品',
    unsure: false,
    ...over,
  });

  it('件数・合計・最大3件と「まとめて合ってる」「1件ずつ見る」。0件なら送らない', () => {
    expect(checkMessage([], ctx.appBaseUrl)).toBeNull();
    const message = checkMessage(
      [item({}), item({ unsure: true })] as never,
      ctx.appBaseUrl,
    ) as Text;
    expect(message.text).toContain('今日の答え合わせ 2件');
    expect(message.quickReply!.items.map((i) => i.action)).toEqual([
      expect.objectContaining({
        type: 'postback',
        label: 'まとめて合ってる',
        data: 'a=check_sure',
      }),
      { type: 'uri', label: '1件ずつ見る', uri: 'https://kakeibo.example/?check=today' },
    ]);
  });

  it('まとめて合ってる:自信のあるものだけ確定し、残りは「1件だけ確かめてください」', async () => {
    s.confirmSure.mockResolvedValue({
      confirmed: 2,
      remaining: [item({ unsure: true, storeName: 'ABC商会' })],
    });
    const text = first(await replyToPostback('a=check_sure', ctx)).text;
    expect(text).toContain('2件を「合ってる」にしました');
    expect(text).toContain('1件だけ確かめてください');
    expect(text).toContain('？ABC商会');
  });
});
