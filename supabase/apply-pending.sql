-- =============================================================================
--  未適用のマイグレーションを、1回のコピペでまとめて適用する(B-17/B-18)
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
--  (P10-30)。このファイルは以後、その時点で未適用だったものだけを持つ。
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
  ) then 'ok' else 'NG: テーブルが無い' end;
