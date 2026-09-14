import { describe, expect, it, vi } from 'vitest';

import { AdvisorChat, AdvisorChatError } from '@/features/advisor/chat';

/**
 * AI相談チャット(本人発案)。モデルの出力そのものは検証できないので、
 * 返答を固定した偽の client を渡して「モデルが何を返してきても、こちらが
 * 正しく扱うか」だけを試す(classification/ai.test.ts と同じ考え方)。
 */

function fakeClient(parse: ReturnType<typeof vi.fn>) {
  return { messages: { parse } } as never;
}

describe('AdvisorChat', () => {
  it('reply と goalProposal(null含む)をそのまま返す', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { reply: 'こんにちは、何を話しましょうか?', goalProposal: null },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const chat = new AdvisorChat('sk-ant-test', fakeClient(parse));

    const result = await chat.reply([{ role: 'user', content: 'こんにちは' }], '今の状況: なし');
    expect(result).toEqual({ reply: 'こんにちは、何を話しましょうか?', goalProposal: null });
  });

  it('目標が固まったときは goalProposal を返す', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        reply: 'この内容で目標として保存できます。',
        goalProposal: {
          title: '旅行費用を貯める',
          targetAmountYen: 150_000,
          targetDate: '2027-03-01',
        },
      },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const chat = new AdvisorChat('sk-ant-test', fakeClient(parse));

    const result = await chat.reply(
      [{ role: 'user', content: '旅行のために15万円貯めたい、来年3月までに' }],
      '今の状況: なし',
    );
    expect(result.goalProposal).toEqual({
      title: '旅行費用を貯める',
      targetAmountYen: 150_000,
      targetDate: '2027-03-01',
    });
  });

  it('コンテキスト文をシステムプロンプトに含めて呼び出す', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { reply: 'ok', goalProposal: null },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const chat = new AdvisorChat('sk-ant-test', fakeClient(parse));

    await chat.reply([{ role: 'user', content: 'こんにちは' }], '残債務: 100,000円');

    const call = parse.mock.calls[0]![0];
    expect(call.system).toMatch(/残債務: 100,000円/);
    expect(call.messages).toEqual([{ role: 'user', content: 'こんにちは' }]);
  });

  it('API が失敗したら AdvisorChatError を投げる', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('接続できません'));
    const chat = new AdvisorChat('sk-ant-test', fakeClient(parse));

    await expect(chat.reply([{ role: 'user', content: 'こんにちは' }], '')).rejects.toThrow(
      AdvisorChatError,
    );
  });

  it('出力が途中で切れたら例外を投げる(部分的な結果を採用しない)', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'max_tokens',
      parsed_output: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const chat = new AdvisorChat('sk-ant-test', fakeClient(parse));

    await expect(chat.reply([{ role: 'user', content: 'こんにちは' }], '')).rejects.toThrow(/切れ/);
  });

  it('会話が空なら呼び出さずに例外を投げる', async () => {
    const parse = vi.fn();
    const chat = new AdvisorChat('sk-ant-test', fakeClient(parse));

    await expect(chat.reply([], '')).rejects.toThrow(AdvisorChatError);
    expect(parse).not.toHaveBeenCalled();
  });
});
