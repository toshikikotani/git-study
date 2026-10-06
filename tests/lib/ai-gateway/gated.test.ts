import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { parseStructuredGated } from '@/lib/ai-gateway/gated';
import { isAiEnabled } from '@/lib/ai-gateway/settings';

vi.mock('@/lib/ai-gateway/settings', () => ({ isAiEnabled: vi.fn() }));

function fakeClient(responses: Array<Record<string, unknown>>) {
  const parse = vi.fn();
  for (const r of responses) parse.mockResolvedValueOnce(r);
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const base = {
  model: 'claude-sonnet-5',
  maxTokens: 100,
  system: 's',
  messages: [{ role: 'user' as const, content: 'u' }],
  schema: z.object({ ok: z.boolean() }),
};

const OK_RESPONSE = {
  stop_reason: 'end_turn',
  parsed_output: { ok: true },
  usage: { input_tokens: 1, output_tokens: 1 },
};
const TRUNCATED_RESPONSE = {
  stop_reason: 'max_tokens',
  parsed_output: null,
  usage: { input_tokens: 1, output_tokens: 100 },
};
const UNPARSABLE_RESPONSE = {
  stop_reason: 'end_turn',
  parsed_output: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

describe('parseStructuredGated', () => {
  beforeEach(() => {
    vi.mocked(isAiEnabled).mockReset();
  });

  it('AI機能がオフなら呼び出さずに失敗を返す', async () => {
    vi.mocked(isAiEnabled).mockResolvedValue(false);
    const { client, parse } = fakeClient([OK_RESPONSE]);

    const result = await parseStructuredGated({ ...base, client });

    expect(result.ok).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  });

  it('1回目で成功すれば再試行しない', async () => {
    vi.mocked(isAiEnabled).mockResolvedValue(true);
    const { client, parse } = fakeClient([OK_RESPONSE]);

    const result = await parseStructuredGated({ ...base, client });

    expect(result.ok).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('truncated なら1回だけ自動再試行し、2回目が成功すればそれを返す', async () => {
    vi.mocked(isAiEnabled).mockResolvedValue(true);
    const { client, parse } = fakeClient([TRUNCATED_RESPONSE, OK_RESPONSE]);

    const result = await parseStructuredGated({ ...base, client });

    expect(result.ok).toBe(true);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('unparsable なら1回だけ自動再試行する', async () => {
    vi.mocked(isAiEnabled).mockResolvedValue(true);
    const { client, parse } = fakeClient([UNPARSABLE_RESPONSE, OK_RESPONSE]);

    const result = await parseStructuredGated({ ...base, client });

    expect(result.ok).toBe(true);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('再試行後も失敗すれば、それ以上は再試行せず失敗を返す(2回まで)', async () => {
    vi.mocked(isAiEnabled).mockResolvedValue(true);
    const { client, parse } = fakeClient([TRUNCATED_RESPONSE, TRUNCATED_RESPONSE]);

    const result = await parseStructuredGated({ ...base, client });

    expect(result.ok).toBe(false);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('api_error(認証エラー等)は再試行しない', async () => {
    vi.mocked(isAiEnabled).mockResolvedValue(true);
    const parse = vi.fn().mockRejectedValue(new Error('network down'));
    const client = { messages: { parse } } as unknown as Anthropic;

    const result = await parseStructuredGated({ ...base, client });

    expect(result.ok).toBe(false);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
