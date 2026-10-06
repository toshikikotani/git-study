/**
 * N1のAIゲートウェイ本体。既存の parseStructured(src/lib/anthropic.ts、
 * ADR-033)を、以降のすべてのAI機能が最初に通す1つの入口として包む:
 *
 *   1. AI機能の一括オフ(app_settings.ai_enabled)をここで見る
 *   2. スキーマ検証に失敗(truncated・unparsable)したら1回だけ自動再試行する
 *      (本人要件「検証に失敗したら1回だけ再試行し、それでも失敗したらAIを
 *      使わない代替表示に切り替える」。api_error は認証・ネットワークの問題で
 *      再試行しても変わらない可能性が高いため対象にしない)
 *
 * 個々の機能はこの関数を呼ぶだけでよく、オン/オフ・再試行を自分で書かない。
 * 返り値の型は既存の StructuredResult のままなので、これまでの呼び出し側の
 * 「!result.ok なら代替表示」という扱い方をそのまま使える。
 */

import type { z } from 'zod';

import { parseStructured, type StructuredRequest, type StructuredResult } from '@/lib/anthropic';
import { isAiEnabled } from './settings';

/** AI機能がオフのときに返す、本人へ見せる言葉。 */
export const AI_DISABLED_MESSAGE = 'AI機能はオフになっています(設定でオンにできます)。';

export async function parseStructuredGated<S extends z.ZodType>(
  request: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const enabled = await isAiEnabled();
  if (!enabled) {
    return { ok: false, failure: 'api_error', message: AI_DISABLED_MESSAGE };
  }

  const first = await parseStructured(request);
  if (first.ok) return first;
  if (first.failure === 'unparsable' || first.failure === 'truncated') {
    return parseStructured(request);
  }
  return first;
}
