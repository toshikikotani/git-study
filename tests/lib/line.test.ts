import { afterEach, describe, expect, it, vi } from 'vitest';

import { LineSendError, postLineMessage } from '@/lib/line';

/**
 * LINE Push Message API への送信(lib/discord.ts の postDiscordEmbed と同じ
 * 役割)。Discord の Webhook と違い送信先 URL が固定(LINE 公式のエンドポイント)
 * のため、ローカル HTTP サーバーへ差し替える形の検証ができない。
 * global.fetch を差し替えて、リクエストの組み立てとエラー処理だけを検証する。
 */
describe('postLineMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正しい URL・ヘッダー・本文で POST する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await postLineMessage('token123', 'Uabc', 'こんにちは');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          authorization: 'Bearer token123',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ to: 'Uabc', messages: [{ type: 'text', text: 'こんにちは' }] });
  });

  it('ステータスが失敗を示すとき LineSendError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' }),
    );

    await expect(postLineMessage('bad-token', 'Uabc', 'text')).rejects.toThrow(LineSendError);
  });
});
