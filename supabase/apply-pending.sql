-- =============================================================================
--  未適用のマイグレーションを、1回のコピペでまとめて適用する(ADR-058)
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
--  B-4/B-5/B-7/B-10/B-12/B-13/B-14/B-15/B-16 は2026-09-22に、ADR-056/057
--  (genres・categories 等の廃止と genre_id への一本化)までのマイグレーションは
--  2026-09-29に本人が適用済み。このファイルは以後、その時点で未適用だった
--  ものだけを持つ。
-- =============================================================================

begin;

-- 1. spending_plans / spending_plan_items — 期間つきの支出目標(ADR-058)
-- -----------------------------------------------------------------------------
-- 3.31 spending_plans / spending_plan_items — 期間つきの支出目標(本人発案、ADR-058)
--
--   カレンダーで選んだ期間(period_start〜period_end)について、ジャンルごとの
--   支出目標を持つ。AIが過去の支出と課題(予算超過・増加傾向・浪費判定・
--   必須ラベル)から目安を提案し(ai_suggested_yen、reason)、本人が
--   target_yen へ直す。step_percent は提案時の「改善の強さ」で、1回の
--   目標で削る幅の上限(徐々に改善するための歯止め)。ジャンルの恒常的な
--   月次予算(genres.budget_yen)とは別物で、期間ごとに立て直していく。
-- -----------------------------------------------------------------------------
create table if not exists public.spending_plans (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  period_start date        not null,
  period_end   date        not null,
  step_percent integer     not null default 10,
  created_at   timestamptz not null default now(),

  constraint ck_spending_plans_period check (period_end >= period_start),
  constraint ck_spending_plans_step   check (step_percent between 0 and 50)
);

create index if not exists ix_spending_plans_user on public.spending_plans (user_id, created_at desc);

create table if not exists public.spending_plan_items (
  id               uuid   primary key default gen_random_uuid(),
  plan_id          uuid   not null references public.spending_plans(id) on delete cascade,
  user_id          uuid   not null references auth.users(id) on delete cascade,
  genre_id         uuid   not null references public.genres(id) on delete cascade,
  target_yen       bigint not null,
  ai_suggested_yen bigint,
  reason           text,

  constraint ck_spending_plan_items_target check (target_yen >= 0),
  constraint ck_spending_plan_items_ai     check (ai_suggested_yen is null or ai_suggested_yen >= 0)
);

create unique index if not exists ux_spending_plan_items_plan_genre
  on public.spending_plan_items (plan_id, genre_id);
create index if not exists ix_spending_plan_items_user on public.spending_plan_items (user_id);

alter table public.spending_plans enable row level security;
alter table public.spending_plans force row level security;

drop policy if exists "own_rows" on public.spending_plans;
create policy "own_rows" on public.spending_plans
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.spending_plan_items enable row level security;
alter table public.spending_plan_items force row level security;

drop policy if exists "own_rows" on public.spending_plan_items;
create policy "own_rows" on public.spending_plan_items
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2. transactions.status / kind — 実績/予定・通常/特別費、分割の子のジャンル補完
-- -----------------------------------------------------------------------------
alter table public.transactions
  add column if not exists status text not null default 'actual',
  add column if not exists kind   text not null default 'normal';

do $$
begin
  alter table public.transactions
    add constraint ck_transactions_status check (status in ('actual', 'scheduled'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.transactions
    add constraint ck_transactions_kind check (kind in ('normal', 'special'));
exception when duplicate_object then null;
end $$;

update public.transactions
  set status = 'scheduled'
  where occurred_on > (now() at time zone 'Asia/Tokyo')::date
    and status <> 'scheduled';

update public.transaction_splits s
  set genre_id = t.genre_id
  from public.transactions t
  where s.transaction_id = t.id
    and s.genre_id is null
    and t.genre_id is not null;

update public.receipt_items i
  set genre_id = t.genre_id
  from public.transactions t
  where i.transaction_id = t.id
    and i.genre_id is null
    and t.genre_id is not null;

commit;

-- =============================================================================
--  確認 — 下の表で status が全部 ok なら完了
-- =============================================================================
select
  'spending_plans' as "テーブル",
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'spending_plans'
  ) then 'ok' else 'NG: テーブルが無い' end as status
union all
select
  'spending_plan_items',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'spending_plan_items'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'transactions.status / kind',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions'
      and column_name in ('status', 'kind')
  ) = 2 then 'ok' else 'NG: 列が無い' end;
