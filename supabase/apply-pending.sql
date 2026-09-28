-- =============================================================================
--  未適用のマイグレーションを、1回のコピペでまとめて適用する(B-17)
--
--  使い方:
--    1. https://supabase.com/dashboard で対象プロジェクトを開く
--    2. 左メニュー「SQL Editor」→「New query」
--    3. このファイルを全部コピーして貼り付け、Run(Ctrl+Enter)
--    4. 最後に出る表で、全部の行が ok になっていることを確認する
--
--  何度実行しても壊れない(既に適用済みの部分は黙って飛ばす)。
--  全体が1つのトランザクションなので、途中で失敗したら何も適用されない。
--
--  これは supabase/migrations/ の未適用分を機械的に連結したもので、内容の正は
--  あくまで supabase/migrations/。ずれていないことは
--  scripts/verify-apply-pending.sh が検証する(CI でも実行する)。
--
--  B-4/B-5/B-7/B-10/B-12/B-13/B-14/B-15/B-16 は2026-09-22に本人が適用済み
--  (P10-30)。このファイルは以後、その時点で未適用だったものだけを持つ
--  (ADR-056 で genres・transaction_genres・receipt_item_genres を追加)。
-- =============================================================================

begin;

-- 1. receipt_items へカテゴリを追加(B-17、本人発案「品目もできれば分類したい」)
-- -----------------------------------------------------------------------------
alter table public.receipt_items
  add column if not exists category_id uuid references public.categories(id) on delete set null;

-- 2. receipt_items へ商品分類(自由記述)を追加(B-18、ADR-036)
-- -----------------------------------------------------------------------------
alter table public.receipt_items
  add column if not exists product_type text;

-- 3. transaction_expense_subtypes — 生活費の小分類(B-18、ADR-036)
-- -----------------------------------------------------------------------------
create table if not exists public.transaction_expense_subtypes (
  transaction_id uuid        primary key references public.transactions(id) on delete cascade,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  subtype        text        not null,
  created_at     timestamptz not null default now(),

  constraint ck_transaction_expense_subtypes_not_blank check (btrim(subtype) <> '')
);

create index if not exists ix_transaction_expense_subtypes_user
  on public.transaction_expense_subtypes (user_id);

alter table public.transaction_expense_subtypes enable row level security;
alter table public.transaction_expense_subtypes force row level security;

drop policy if exists "own_rows" on public.transaction_expense_subtypes;
create policy "own_rows" on public.transaction_expense_subtypes
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 4. genres — 支出の客観的なジャンル一覧(ADR-056、本人発案)
-- -----------------------------------------------------------------------------
create table if not exists public.genres (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now(),

  constraint ck_genres_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists ux_genres_user_name on public.genres (user_id, name);
create index if not exists ix_genres_user on public.genres (user_id, sort_order);

alter table public.genres enable row level security;
alter table public.genres force row level security;

drop policy if exists "own_rows" on public.genres;
create policy "own_rows" on public.genres
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 5. transaction_genres — 明細1件全体の客観ジャンル(ADR-056)
-- -----------------------------------------------------------------------------
create table if not exists public.transaction_genres (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  transaction_id uuid        not null references public.transactions(id) on delete cascade,
  genre_id       uuid        not null references public.genres(id) on delete cascade,

  created_at     timestamptz not null default now()
);

create unique index if not exists ux_transaction_genres_transaction
  on public.transaction_genres (transaction_id);
create index if not exists ix_transaction_genres_user on public.transaction_genres (user_id);
create index if not exists ix_transaction_genres_genre on public.transaction_genres (genre_id);

alter table public.transaction_genres enable row level security;
alter table public.transaction_genres force row level security;

drop policy if exists "own_rows" on public.transaction_genres;
create policy "own_rows" on public.transaction_genres
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 6. receipt_item_genres — 品目1点ごとの客観ジャンル(ADR-056)
-- -----------------------------------------------------------------------------
create table if not exists public.receipt_item_genres (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  receipt_item_id uuid        not null references public.receipt_items(id) on delete cascade,
  genre_id        uuid        not null references public.genres(id) on delete cascade,

  created_at      timestamptz not null default now()
);

create unique index if not exists ux_receipt_item_genres_item
  on public.receipt_item_genres (receipt_item_id);
create index if not exists ix_receipt_item_genres_user on public.receipt_item_genres (user_id);
create index if not exists ix_receipt_item_genres_genre on public.receipt_item_genres (genre_id);

alter table public.receipt_item_genres enable row level security;
alter table public.receipt_item_genres force row level security;

drop policy if exists "own_rows" on public.receipt_item_genres;
create policy "own_rows" on public.receipt_item_genres
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;

-- =============================================================================
--  確認 — 下の表で status が全部 ok なら完了
-- =============================================================================
select
  'receipt_items.category_id' as "テーブル・列",
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'receipt_items'
      and column_name = 'category_id'
  ) then 'ok' else 'NG: 列が無い' end as status
union all
select
  'receipt_items.product_type',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'receipt_items'
      and column_name = 'product_type'
  ) then 'ok' else 'NG: 列が無い' end
union all
select
  'transaction_expense_subtypes',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transaction_expense_subtypes'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'genres',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'genres'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'transaction_genres',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transaction_genres'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'receipt_item_genres',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'receipt_item_genres'
  ) then 'ok' else 'NG: テーブルが無い' end;
