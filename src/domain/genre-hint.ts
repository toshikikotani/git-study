/**
 * AIが返した「ジャンル名らしき文字列」(genre_hint)を、実在するジャンルの
 * idへ解決する(N3)。一覧に無い名前を作らない前提のプロンプトだが、念のため
 * 完全一致しないものは無分類(null)として扱う。
 */
export function resolveGenreHint(
  genreHint: string | null,
  genres: readonly { id: string; name: string }[],
): string | null {
  if (genreHint === null) return null;
  return genres.find((g) => g.name === genreHint)?.id ?? null;
}
