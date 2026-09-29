import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { GENRE_COLOR_COUNT, genreStyle, type GenreStyleOverride } from '@/domain/genre-style';
import { SELECTABLE_ICONS, selectableColorIndexes } from '@/domain/genre-style';

export class GenreStyleError extends AppError {}

/**
 * 利用者が選んだカテゴリの見た目(名前 → 上書き)。マイグレーション未適用や通信失敗のときは
 * 空(=既定の見た目)を返す。見た目の読み込みが画面全体を止めてはいけない。
 */
export async function loadGenreStyleOverrides(): Promise<Record<string, GenreStyleOverride>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('genres').select('name, icon_key, color_index');
    if (error || !data) return {};
    const out: Record<string, GenreStyleOverride> = {};
    for (const row of data as {
      name: string;
      icon_key: string | null;
      color_index: number | null;
    }[]) {
      if (row.icon_key === null && row.color_index === null) continue;
      out[row.name] = {
        icon: SELECTABLE_ICONS.includes(row.icon_key as never) ? (row.icon_key as never) : null,
        colorIndex: row.color_index,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** 名前の検証(空・長すぎ)。 */
export function validateGenreName(input: string): string {
  const name = input.trim();
  if (name === '') throw new GenreStyleError('カテゴリ名を入力してください');
  if ([...name].length > 20) throw new GenreStyleError('カテゴリ名は20文字までにしてください');
  if (name === '未分類') throw new GenreStyleError('「未分類」は使えない名前です');
  return name;
}

/**
 * カテゴリ名を変える。名前で決まる既定の見た目が変わらないよう、変える前の見た目を
 * 先に書き留める(列が無い環境では書き留めを飛ばし、名前だけ変える)。
 */
export async function renameGenre(id: string, newName: string): Promise<void> {
  const name = validateGenreName(newName);
  const supabase = await createClient();
  const { data: current } = await supabase
    .from('genres')
    .select('name, icon_key, color_index')
    .eq('id', id)
    .maybeSingle();
  if (!current) throw new GenreStyleError('カテゴリが見つかりませんでした');
  const row = current as { name: string; icon_key: string | null; color_index: number | null };
  if (row.name === name) return;
  const before = genreStyle(row.name, { icon: row.icon_key as never, colorIndex: row.color_index });
  const { error: styleError } = await supabase
    .from('genres')
    .update({ icon_key: before.icon, color_index: before.colorIndex })
    .eq('id', id);
  void styleError; // 列が無い環境では書き留められない(名前の変更は続ける)
  const { error } = await supabase.from('genres').update({ name }).eq('id', id);
  if (error) {
    if (error.code === '23505') throw new GenreStyleError('同じ名前のカテゴリがすでにあります');
    throw new GenreStyleError(`名前を変えられませんでした: ${error.message}`);
  }
}

export async function saveGenreStyle(
  id: string,
  style: { icon: string; colorIndex: number },
): Promise<void> {
  if (!SELECTABLE_ICONS.includes(style.icon as never)) {
    throw new GenreStyleError('選べないアイコンです');
  }
  if (
    !Number.isInteger(style.colorIndex) ||
    style.colorIndex < 1 ||
    style.colorIndex > GENRE_COLOR_COUNT ||
    !selectableColorIndexes().includes(style.colorIndex)
  ) {
    throw new GenreStyleError('選べない色です');
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('genres')
    .update({ icon_key: style.icon, color_index: style.colorIndex })
    .eq('id', id);
  if (error) throw new GenreStyleError(`見た目を保存できませんでした: ${error.message}`);
}
