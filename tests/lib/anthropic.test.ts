import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { parseStructured } from '@/lib/anthropic';

/**
 * Sonnet 5 は thinking を指定しないと常に適応的に考え(effort 既定 high)、
 * その分も max_tokens に数えられる。軽い判断の呼び出しがそれを抑えられる
 * ことと、指定しない呼び出しの形が変わらないことを固定する。
 */

function fakeClient() {
  const parse = vi.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    parsed_output: { ok: true },
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const base = {
  model: 'claude-sonnet-5',
  maxTokens: 100,
  system: 's',
  messages: [{ role: 'user' as const, content: 'u' }],
  schema: z.object({ ok: z.boolean() }),
};

describe('parseStructured の thinking / effort', () => {
  it('disableThinking と effort を API 呼び出しへ渡す', async () => {
    const { client, parse } = fakeClient();
    await parseStructured({ ...base, client, disableThinking: true, effort: 'low' });

    const args = parse.mock.calls[0]![0];
    expect(args.thinking).toEqual({ type: 'disabled' });
    expect(args.output_config.effort).toBe('low');
    expect(args.output_config.format).toBeDefined();
  });

  it('指定しなければ thinking も effort も送らない(Haiku など非対応モデルを壊さない)', async () => {
    const { client, parse } = fakeClient();
    await parseStructured({ ...base, client, model: 'claude-haiku-4-5' });

    const args = parse.mock.calls[0]![0];
    expect('thinking' in args).toBe(false);
    expect('effort' in args.output_config).toBe(false);
  });
});
