-- =============================================================================
--  genres — 支出の客観的なジャンル一覧(本人発案、ADR-056)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260928000100_genres.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.30 genres — 支出の客観的なジャンル一覧(本人発案、ADR-056)
-- -----------------------------------------------------------------------------
-- 当初は固定enum(spending_genre)として設計したが、本人から「カテゴリはdbに
-- 保存してenumじゃなくて、自由に変更できる仕組みに。追加削除容易にしたい」との
-- 指摘を受け、categories(FR-13)と同じ「本人が自由に追加・削除できるDBテーブル」
-- に変更した。categories と違い kind・budgetYen・show_on_home・is_system・
-- 統合(merged_into_id)は持たない——ジャンルは予算やアラート判定に使う構造的な
-- カテゴリではなく、AIが付ける補助的な分類タグであり、参照ロジックが無いため
-- 削除も統合を経由せず即座に行える(genre_id 側を on delete cascade にする)。
create table public.genres (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now(),

  constraint ck_genres_name_not_blank check (btrim(name) <> '')
);

create unique index ux_genres_user_name on public.genres (user_id, name);
create index ix_genres_user on public.genres (user_id, sort_order);

commit;
