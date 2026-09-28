/**
 * 「ジャンル」を扱うAIチャット機能の純粋な部分(ADR-057)。
 *
 * DB にもネットワークにも触れない(`features/transactions/chat-tools.ts` と
 * 同じ構成)。ADR-057によりパターンルール(classification_rules)は廃止した
 * ため、旧 `features/classification/chat-tools.ts` のうちルール関連
 * (`describeRuleUpdate`・`RuleContext`・`formatRuleContextLines`・
 * `isMatchType`)は引き継がない——ジャンル名の解決と一覧整形だけを残す。
 */

import { ChatToolError } from '@/lib/chat-tools';

export { ChatToolError };

export type NamedGenre = { id: string; name: string };

/**
 * モデルが返したジャンル名を、実在のジャンルに解決する。
 * 存在しない名前は勝手に読み替えず、候補を添えて拒む(本人の知らないジャンルを
 * 作らせないため)。
 */
export function resolveGenreByName<G extends NamedGenre>(name: unknown, genres: readonly G[]): G {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ChatToolError('ジャンル名が指定されていません。');
  }
  const wanted = name.trim();
  const found = genres.find((g) => g.name.trim() === wanted);
  if (!found) {
    const available = genres.map((g) => g.name).join('、');
    throw new ChatToolError(
      `「${wanted}」というジャンルは見つかりません。既存のジャンル: ${available}`,
    );
  }
  return found;
}

/**
 * システムプロンプトに埋め込むジャンルの現在値を整形する
 * (list 用の tool を往復させない。高々数十件なので、埋め込んだ方が速く・安く済む)。
 */
export function formatGenreContextLines(genres: readonly NamedGenre[]): string {
  const lines = genres.map((g) => `- ${g.name}`).join('\n');
  return lines === '' ? '(まだ1件もありません)' : lines;
}
