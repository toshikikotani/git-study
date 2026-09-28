/**
 * 取り込み画面(CSV / メール貼り付け / レシート撮影)共通の
 * 「ジャンル一覧を取得する」呼び出し(ADR-057)。
 *
 * CSV・メール貼り付けは取り込み時にAIで確定させない(本人が選ぶか、
 * 後からAIジャンル分類にまとめて任せる)。レシート撮影だけは読み取り直後に
 * AIがジャンルを先に埋める(features/genre/receipt-classify.ts)。ここでは
 * プレビュー画面の選択欄に出す選択肢だけを取得する。
 */

export type GenreOption = { id: string; name: string };

export async function fetchGenreOptions(): Promise<GenreOption[]> {
  try {
    const response = await fetch('/api/genres');
    if (!response.ok) return [];
    const data = (await response.json()) as { genres: GenreOption[] };
    return data.genres;
  } catch {
    return [];
  }
}
