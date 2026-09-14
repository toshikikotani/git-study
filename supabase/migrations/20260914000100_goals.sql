-- =============================================================================
--  goals — 目標(AI相談で決めた貯蓄目標・買い物目標、本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260914000100_goals.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

create type goal_status as enum ('active', 'achieved', 'abandoned');

-- 3.23 goals — AI相談(目標設定・買う前相談)で決めた目標(本人発案)
-- -----------------------------------------------------------------------------
-- 「◯月までに◯万円貯める」のような目標を、対話の結果として保存する。
-- 進捗(current_amount_yen)は自動計算せず本人が更新する(口座連携が無く、
-- 収支全体からの推定では「この目標のために」貯めた額と一致しない可能性が
-- あるため。TASKS.md 参照)。target_amount_yen/target_date は無くても
-- 目標として成立する(「浪費を減らす」のような金額・期限を持たない目標もある)。
create table public.goals (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,

  title              text        not null,
  target_amount_yen  bigint,
  target_date        date,
  current_amount_yen bigint      not null default 0,

  status             goal_status not null default 'active',
  note               text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  achieved_at        timestamptz,

  constraint ck_goals_title_not_blank check (btrim(title) <> ''),
  constraint ck_goals_target_amount   check (target_amount_yen is null or target_amount_yen > 0),
  constraint ck_goals_current_amount  check (current_amount_yen >= 0),
  constraint ck_goals_achieved        check ((status = 'achieved') = (achieved_at is not null))
);

create index ix_goals_user_status on public.goals (user_id, status, created_at desc);

create trigger trg_goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

commit;
