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
    expect(args.thinking).toEqual({ type: 'between_tools' });
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

describe('parseStructured の server-side fallback(ADR-119)', () => {
  function betaClient(stopReason = 'end_turn') {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: stopReason,
      parsed_output: stopReason === 'refusal' ? null : { ok: true },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const plain = vi.fn();
    return {
      client: { messages: { parse: plain }, beta: { messages: { parse } } } as unknown as Anthropic,
      parse,
      plain,
    };
  }

  it('fallbacks を付けると、ベータの呼び出しで default の代わりのモデルを頼む', async () => {
    const { client, parse, plain } = betaClient();
    const result = await parseStructured({
      ...base,
      client,
      model: 'claude-opus-5-5',
      effort: 'low',
      fallbacks: 'default',
    });
    expect(result.ok).toBe(true);
    expect(plain).not.toHaveBeenCalled();
    const args = parse.mock.calls[0]![0];
    expect(args.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(args.fallbacks).toBe('default');
    expect(args.output_config.effort).toBe('low');
    expect('thinking' in args).toBe(false);
  });

  it('答えなかった(refusal)ときは、そう伝える', async () => {
    const { client } = betaClient('refusal');
    const result = await parseStructured({ ...base, client, fallbacks: 'default' });
    expect(result).toMatchObject({ ok: false, message: 'AI がこの内容には答えられませんでした。' });
  });
});
