'use server';

/**
 * N3(AIによる入力)の抽出 Server Action。保存自体は既存の
 * saveImportBatchAction(actions.ts)をそのまま使う——ここでは「文章 → 候補」の変換だけを担う。
 * スクショは記録するの「画像から入力」でレシートと同じ読み取りに乗せた(ADR-100)。
 */

import {
  ClaudeNaturalTextCaptureAnalyzer,
  type NaturalTextCandidate,
} from '@/features/import/natural-text-ai';
import { listGenres } from '@/features/genre/store';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { readAnthropicApiKey } from '@/lib/env';
import { todayJst } from '@/lib/date';

export type CaptureActionResult<T> = { candidates: T[]; warnings: string[]; error: string | null };

export async function extractFromTextAction(
  text: string,
): Promise<CaptureActionResult<NaturalTextCandidate>> {
  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return { candidates: [], warnings: [], error: apiKeyMissingMessage('文字で記録') };
  }
  const genres = await listGenres();
  const outcome = await new ClaudeNaturalTextCaptureAnalyzer(apiKey).extract({
    text,
    today: todayJst(),
    genreNames: genres.map((g) => g.name),
  });
  if (outcome.candidates === null) {
    return {
      candidates: [],
      warnings: outcome.warnings,
      error: outcome.warnings[0] ?? 'AIの呼び出しに失敗しました。',
    };
  }
  return { candidates: outcome.candidates, warnings: outcome.warnings, error: null };
}

export type GenreNameOption = { id: string; name: string };

export async function fetchGenreNameOptionsAction(): Promise<GenreNameOption[]> {
  const genres = await listGenres();
  return genres.map((g) => ({ id: g.id, name: g.name }));
}
