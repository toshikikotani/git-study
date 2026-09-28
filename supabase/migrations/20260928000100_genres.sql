-- =============================================================================
--  genres — 支出の唯一の分類(本人発案、ADR-056/ADR-057)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260928000100_genres.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.3 genres — 支出の唯一の分類(本人発案、ADR-056/ADR-057)
-- -----------------------------------------------------------------------------
-- 当初は固定enum(spending_genre)として設計したが、本人から「カテゴリはdbに
-- 保存してenumじゃなくて、自由に変更できる仕組みに。追加削除容易にしたい」との
-- 指摘を受け、categories(FR-13)と同じ「本人が自由に追加・削除できるDBテーブル」
-- に変更した。さらにADR-057で「今までの生活費・浪費などユーザー定義の主観的な
-- カテゴリ分けを完全に廃止し、ジャンル(AIが客観的に割り当てる分類)を唯一の
-- カテゴリにする」という決定により、旧 categories の役割(予算設定・ホーム表示枠)
-- を丸ごと引き継いだ。kind・is_system・統合(merged_into_id)は引き継がない
-- ——ジャンルは本人が自由に追加・削除できる対象で、予算やアラート判定に
-- 「特別扱いする種類」を作らないため(削除は統合を経由せず即座に行える。
-- 参照側の genre_id を on delete cascade/set null にする)。
create table public.genres (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  sort_order   integer     not null default 0,

  -- 月次予算(本人発案「カテゴリのそれぞれの値段設定」)。未設定なら無制限。
  budget_yen   bigint,

  -- ホーム画面に残額を出すジャンルか(旧 categories.show_on_home、FR-14, FR-61)。
  show_on_home boolean     not null default false,

  created_at   timestamptz not null default now(),

  constraint ck_genres_name_not_blank check (btrim(name) <> ''),
  constraint ck_genres_budget check (budget_yen is null or budget_yen >= 0)
);

create unique index ux_genres_user_name on public.genres (user_id, name);
create index ix_genres_user on public.genres (user_id, sort_order);
create index ix_genres_show_on_home on public.genres (user_id, sort_order)
  where show_on_home;

commit;
