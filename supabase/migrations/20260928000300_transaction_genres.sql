-- =============================================================================
--  transaction_genres — 明細ごとの客観的な支出ジャンル分類(本人発案、ADR-056)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260928000300_transaction_genres.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.31 transaction_genres — 明細1件全体の客観ジャンル(本人発案、ADR-056)
-- -----------------------------------------------------------------------------
-- category_kind(生活費/浪費...)・カテゴリ名は本人が決めた主観的な分類。
-- ここではレシート品目の無い明細(CSV・メール取り込み・手入力等)1件全体に
-- 対して、AIが内容から機械的に割り当てる客観的なジャンル(genres)を保存する。
-- レシート品目がある明細は品目ごとに receipt_item_genres 側で分類するため、
-- このテーブルは対象にしない(store層が使い分ける)。1明細につき1行
-- (再分類は upsert で上書き。transaction_diagnoses と同じ「履歴を重ねて
-- 残さない」設計)。genre_id は on delete cascade——ジャンルを削除したときに
-- 参照が残って本人を困らせない(削除は使われていても即座にできる、
-- genres.sql 参照)。
create table public.transaction_genres (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  transaction_id uuid        not null references public.transactions(id) on delete cascade,
  genre_id       uuid        not null references public.genres(id) on delete cascade,

  created_at     timestamptz not null default now()
);

create unique index ux_transaction_genres_transaction on public.transaction_genres (transaction_id);
create index ix_transaction_genres_user on public.transaction_genres (user_id);
create index ix_transaction_genres_genre on public.transaction_genres (genre_id);

commit;
