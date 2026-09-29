-- =============================================================================
--  カテゴリの見た目(アイコン・色)を利用者が選べるようにする(カテゴリ詳細 P8)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000500_genre_style.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--
--  - icon_key   : domain/genre-style.ts の GenreIconKey。null は名前からの既定。
--  - color_index: 1〜10(CSS の --genre-N)。null は名前からの既定。
--  既存のジャンルは null のまま(見た目は変わらない)。名前を変えるときは、
--  変える前の見た目をここへ書き留めてから変える(名前で決まる既定が変わらないように)。
-- =============================================================================

begin;

alter table public.genres add column if not exists icon_key text;
alter table public.genres add column if not exists color_index smallint;

alter table public.genres drop constraint if exists ck_genres_color_index;
alter table public.genres
  add constraint ck_genres_color_index check (color_index is null or color_index between 1 and 10);

commit;
