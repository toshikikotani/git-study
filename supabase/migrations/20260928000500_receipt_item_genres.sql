-- =============================================================================
--  receipt_item_genres — レシート品目1点ごとの客観的な支出ジャンル分類
--  (本人発案、ADR-056)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260928000500_receipt_item_genres.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.32 receipt_item_genres — 品目1点ごとの客観ジャンル(本人発案、ADR-056)
-- -----------------------------------------------------------------------------
-- 本人発案「商品のカテゴリー分けを自動で行う」(例:外食費の中の清涼飲料水)。
-- receipt_items.product_type(ADR-036)はAIの自由記述で、表記ゆれがあり
-- 集計に向かない。ここでは同じ品目に対し、本人が管理する固定のジャンル一覧
-- (genres)から機械的に1つ選んだ結果を保存する——product_type は「AIが見た
-- ままを書く」役割のまま残し、こちらは「後で集計できる形に丸める」役割を
-- 別テーブルで持たせる(両者の目的が違うため、同じ列に混ぜない)。
-- 1品目につき1行。genre_id は on delete cascade(transaction_genres と同じ)。
create table public.receipt_item_genres (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  receipt_item_id uuid        not null references public.receipt_items(id) on delete cascade,
  genre_id        uuid        not null references public.genres(id) on delete cascade,

  created_at      timestamptz not null default now()
);

create unique index ux_receipt_item_genres_item on public.receipt_item_genres (receipt_item_id);
create index ix_receipt_item_genres_user on public.receipt_item_genres (user_id);
create index ix_receipt_item_genres_genre on public.receipt_item_genres (genre_id);

commit;
