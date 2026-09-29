-- =============================================================================
--  レシート取り込みの分類の記憶(個人の履歴・利用者のルール)と、店名の支店名・
--  照合の差額
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000200_receipt_memory.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--
--  - genre_memory: 分類パイプライン(利用者のルール → 個人の履歴 → 品目辞書 → AI)の
--    前半 2 段の元データ。store_key='' は「どの店でも」。pinned=true が利用者のルール。
--  - transactions.branch_name: 店名を正規化して分けた支店名(merchant_name は店名のみ)。
--  - transactions.reconcile_diff_yen: レシートの照合で解消していない差額(0/null なら一致)。
--    要確認カードの「金額不一致」に使う。
-- =============================================================================

begin;

alter table public.transactions
  add column branch_name        text,
  add column reconcile_diff_yen integer;

create table public.genre_memory (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  store_key  text        not null default '',
  item_key   text        not null,
  genre_id   uuid        not null references public.genres(id) on delete cascade,
  pinned     boolean     not null default false,
  hits       integer     not null default 1,
  updated_at timestamptz not null default now(),

  constraint ck_genre_memory_item_not_blank check (btrim(item_key) <> ''),
  constraint ck_genre_memory_hits check (hits >= 1)
);

create unique index ux_genre_memory_key
  on public.genre_memory (user_id, store_key, item_key);
create index ix_genre_memory_user on public.genre_memory (user_id);

alter table public.genre_memory enable row level security;
alter table public.genre_memory force row level security;

drop policy if exists "own_rows" on public.genre_memory;
create policy "own_rows" on public.genre_memory
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
