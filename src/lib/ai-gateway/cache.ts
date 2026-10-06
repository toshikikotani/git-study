/**
 * AI応答のキャッシュ(N1本人要件「同じ入力の結果はキャッシュする」)。
 *
 * サーバーレス関数はプロセスをまたいだメモリを持てないため、DB(ai_cache)に
 * 置く。キーは「機能名 + 入力の安定した JSON 表現のハッシュ」——同じ機能へ
 * 同じ入力(オブジェクトのキー順序が違っても同じ内容)を渡せば同じキーになる。
 */

import { createHash } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** オブジェクトのキー順序に依存しない、安定した JSON 文字列化。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

export function cacheKeyFor(feature: string, input: unknown): string {
  const hash = createHash('sha256').update(stableStringify(input)).digest('hex');
  return `${feature}:${hash}`;
}

/**
 * feature+input が一致するキャッシュが有効期限内にあればそれを返す。無ければ
 * compute() を実行し、shouldCache(既定は常に true)が true を返した結果だけを
 * 保存する——AI呼び出しの失敗(report: null 等)まで固定してしまわないため、
 * 生成に失敗した機能は shouldCache で明示的に除く。
 */
export async function withAiCache<T>(
  feature: string,
  input: unknown,
  compute: () => Promise<T>,
  options?: { ttlMs?: number; shouldCache?: (result: T) => boolean },
): Promise<T> {
  const key = cacheKeyFor(feature, input);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return compute();

  const { data: cached } = await supabase
    .from('ai_cache')
    .select('response_json, expires_at')
    .eq('cache_key', key)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    return cached.response_json as T;
  }

  const result = await compute();
  const shouldCache = options?.shouldCache ?? (() => true);
  if (shouldCache(result)) {
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    await supabase.from('ai_cache').upsert({
      cache_key: key,
      user_id: auth.user.id,
      feature,
      response_json: result as unknown as Json,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
  }

  return result;
}
