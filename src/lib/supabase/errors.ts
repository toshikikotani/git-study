import type { PostgrestError } from '@supabase/supabase-js';

/**
 * テーブルがまだ本番に無い(マイグレーション未適用)ときの PostgREST のコード。
 *
 * 未適用のあいだの扱いは全機能で同じにする(ADR-033):
 *   読み取り — 「まだ無い」として握り潰し、空で描画する(画面全体を落とさない)
 *   書き込み — 本人の明示操作なので握り潰さず、その機能名でエラーを返す
 */
export function isMissingTableError(error: Pick<PostgrestError, 'code'>): boolean {
  return error.code === 'PGRST205';
}

/**
 * 列がまだ本番に無い(マイグレーション未適用)ときのコード。
 * INSERT では PGRST204(PostgREST のスキーマキャッシュ層)、SELECT では
 * 42703(Postgres 本来のエラー)を返すことがある(features/transactions/
 * store.ts で実際の本番 Supabase に対して確認済み)。どちらも「列が無い」
 * ことを意味するため両方見る。
 */
export function isMissingColumnError(error: Pick<PostgrestError, 'code'>): boolean {
  return error.code === 'PGRST204' || error.code === '42703';
}
