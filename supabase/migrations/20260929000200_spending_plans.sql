-- =============================================================================
--  spending_plans / spending_plan_items — 期間つきの支出目標(本人発案、ADR-058)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260929000200_spending_plans.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.31 spending_plans / spending_plan_items — 期間つきの支出目標(本人発案、ADR-058)
--
--   カレンダーで選んだ期間(period_start〜period_end)について、ジャンルごとの
--   支出目標を持つ。AIが過去の支出と課題(予算超過・増加傾向・浪費判定・
--   必須ラベル)から目安を提案し(ai_suggested_yen、reason)、本人が
--   target_yen へ直す。step_percent は提案時の「改善の強さ」で、1回の
--   目標で削る幅の上限(徐々に改善するための歯止め)。ジャンルの恒常的な
--   月次予算(genres.budget_yen)とは別物で、期間ごとに立て直していく。
-- -----------------------------------------------------------------------------
create table public.spending_plans (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  period_start date        not null,
  period_end   date        not null,
  step_percent integer     not null default 10,
  created_at   timestamptz not null default now(),

  constraint ck_spending_plans_period check (period_end >= period_start),
  constraint ck_spending_plans_step   check (step_percent between 0 and 50)
);

create index ix_spending_plans_user on public.spending_plans (user_id, created_at desc);

create table public.spending_plan_items (
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

create unique index ux_spending_plan_items_plan_genre
  on public.spending_plan_items (plan_id, genre_id);
create index ix_spending_plan_items_user on public.spending_plan_items (user_id);

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

commit;
