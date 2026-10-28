import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  after: [] as (() => Promise<void>)[],
  replies: [] as { token: string; messages: unknown[] }[],
  runAsOwner: vi.fn(),
  text: vi.fn(),
  postback: vi.fn(),
  keep: vi.fn(),
  pushes: [] as unknown[][],
}));

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (fn: () => Promise<void>) => {
    s.after.push(fn);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert: async () => ({}) }) }),
}));
vi.mock('@/lib/supabase/owner', () => ({
  findOwner: async () => ({
    user: { id: 'me', email: 'me@example.com', created_at: '' },
    error: null,
  }),
}));
vi.mock('@/lib/supabase/owner-session', () => ({
  runAsOwner: (_admin: unknown, owner: unknown, fn: () => Promise<unknown>) => {
    s.runAsOwner(owner);
    return fn();
  },
}));
vi.mock('@/features/line/conversation', () => ({
  replyToText: (...args: unknown[]) => s.text(...args),
  replyToPostback: (...args: unknown[]) => s.postback(...args),
}));
vi.mock('@/lib/line', async (original) => ({
  ...(await original<typeof import('@/lib/line')>()),
  replyLineMessages: async (_token: string, replyToken: string, messages: unknown[]) => {
    s.replies.push({ token: replyToken, messages });
  },
  pushLineMessages: async (_token: string, _to: string, messages: unknown[]) => {
    s.pushes.push(messages);
  },
  fetchLineImageAsBase64: async () => 'aW1hZ2U=',
}));
vi.mock('@/features/receipt-captures/keep-photo', async (original) => ({
  ...(await original<typeof import('@/features/receipt-captures/keep-photo')>()),
  keepReceiptPhotoForCheck: (...args: unknown[]) => s.keep(...args),
}));
// 写真から明細を入れる関数は呼ばれない(呼ばれたら落とす)。
vi.mock('@/features/transactions/store', () => ({
  importTransactions: () => {
    throw new Error('レシートを自動で記録しようとした');
  },
  importTransactionsAsAdmin: () => {
    throw new Error('レシートを自動で記録しようとした');
  },
}));

import { POST } from '../../app/api/webhooks/line/route';

const ME = 'U00000000000000000000000000000000';
const SOMEONE = 'U11111111111111111111111111111111';

/** LINE の受信(v4-2、ADR-130):本人以外の文字やボタンは無視する。 */

const SECRET = 'channel-secret';
function request(events: unknown[], secret = SECRET) {
  const body = JSON.stringify({ events });
  const signature = createHmac('sha256', secret).update(body).digest('base64');
  return new Request('https://example.test/api/webhooks/line', {
    method: 'POST',
    body,
    headers: { 'x-line-signature': signature },
  });
}
const text = (userId: string, value: string) => ({
  type: 'message',
  replyToken: `r-${value}`,
  message: { type: 'text', id: `m-${value}`, text: value },
  source: { type: 'user', userId },
});

beforeEach(() => {
  vi.clearAllMocks();
  s.after = [];
  s.replies = [];
  s.pushes = [];
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 't'.repeat(60);
  process.env.LINE_USER_ID = ME;
  process.env.LINE_CHANNEL_SECRET = SECRET;
  process.env.LINE_RECEIPT_ACCOUNT_ID = '11111111-2222-4333-8444-555555555555';
  process.env.APP_BASE_URL = 'https://kakeibo.example/';
  s.text.mockResolvedValue([{ type: 'text', text: '記録しました' }]);
  s.postback.mockResolvedValue([{ type: 'text', text: 'OK' }]);
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  s.keep.mockResolvedValue({
    ready: [
      {
        id: 'cap-1',
        storeName: 'ライフ',
        occurredOn: '2026-10-27',
        amountYen: 1800,
        genreName: '食料品',
      },
    ],
    needsInputId: null,
    warnings: [],
    error: null,
  });
});

describe('LINE の受信', () => {
  it('署名が合わなければ断る', async () => {
    const response = await POST(request([text(ME, 'ランチ 1200')], 'wrong'));
    expect(response.status).toBe(401);
    expect(s.text).not.toHaveBeenCalled();
  });

  it('本人の文字には、本人として答えて返信トークンで返す(200 はすぐ返し、返事はあとで)', async () => {
    const response = await POST(request([text(ME, 'ランチ 1200')]));
    expect(response.status).toBe(200);
    expect(s.text).not.toHaveBeenCalled();
    await Promise.all(s.after.map((fn) => fn()));
    expect(s.runAsOwner).toHaveBeenCalledWith(expect.objectContaining({ id: 'me' }));
    expect(s.text).toHaveBeenCalledWith('ランチ 1200', {
      messageId: 'm-ランチ 1200',
      accountId: '11111111-2222-4333-8444-555555555555',
      appBaseUrl: 'https://kakeibo.example',
    });
    expect(s.replies).toEqual([
      { token: 'r-ランチ 1200', messages: [{ type: 'text', text: '記録しました' }] },
    ]);
  });

  it('本人以外の LINE からの文字やボタンは無視する', async () => {
    await POST(
      request([
        text(SOMEONE, 'ランチ 1200'),
        {
          type: 'postback',
          replyToken: 'r-x',
          postback: { data: 'a=check_sure' },
          source: { type: 'user', userId: SOMEONE },
        },
      ]),
    );
    await Promise.all(s.after.map((fn) => fn()));
    expect(s.text).not.toHaveBeenCalled();
    expect(s.postback).not.toHaveBeenCalled();
    expect(s.replies).toEqual([]);
  });

  it('本人のボタンにも答える', async () => {
    await POST(
      request([
        {
          type: 'postback',
          replyToken: 'r-p',
          webhookEventId: 'ev-1',
          postback: { data: 'a=check_sure' },
          source: { type: 'user', userId: ME },
        },
      ]),
    );
    await Promise.all(s.after.map((fn) => fn()));
    expect(s.postback).toHaveBeenCalledWith(
      'a=check_sure',
      expect.objectContaining({ messageId: 'ev-1' }),
    );
    expect(s.replies).toHaveLength(1);
  });
});

describe('LINE で送ったレシートの写真(ADR-141)', () => {
  const image = (userId: string) => ({
    type: 'message',
    replyToken: 'r-img',
    message: { type: 'image', id: 'img-1' },
    source: { type: 'user', userId },
  });

  it('記録はせず、本人として保存前に残し、読み取った内容と「確かめて保存」を返す', async () => {
    const response = await POST(request([image(ME)]));
    expect(response.status).toBe(200);
    expect(s.runAsOwner).toHaveBeenCalledWith(expect.objectContaining({ id: 'me' }));
    expect(s.keep).toHaveBeenCalledWith(expect.objectContaining({ imageBase64: 'aW1hZ2U=' }));
    const [message] = s.pushes[0] as {
      text: string;
      quickReply: { items: { action: { label: string; uri: string } }[] };
    }[];
    expect(message!.text).toContain('まだ保存していません');
    expect(message!.text).toContain('10/27 ライフ 1,800円(食料品)');
    expect(message!.text).not.toContain('保存しました');
    expect(message!.quickReply.items[0]!.action).toEqual({
      type: 'uri',
      label: '確かめて保存',
      uri: 'https://kakeibo.example/spending/review?receipt=cap-1',
    });
  });

  it('本人以外の写真は読み取らない', async () => {
    await POST(request([image(SOMEONE)]));
    expect(s.keep).not.toHaveBeenCalled();
    expect(s.pushes).toEqual([]);
  });
});
