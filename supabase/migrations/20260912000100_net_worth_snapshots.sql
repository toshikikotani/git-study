-- =============================================================================
--  net_worth_snapshots — 資産推移(残債総額 + 投資評価額)の月次記録(P6-3)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260912000100_net_worth_snapshots.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.22 net_worth_snapshots — 資産推移の月次記録(P6-3)
-- -----------------------------------------------------------------------------
-- debts.current_balance_yen は現在値のみで履歴を持たない。資産推移グラフ
-- (残債総額 + 投資評価額の時系列)を出すには、月末に両者の合計を1行として
-- 記録し始める必要がある(TASKS.md P6-3)。投資評価額は investment_snapshots
-- (商品ごとの時点スナップショット)から、記録時点で商品ごとに最新の値を
-- 合算したもの。(user_id, as_of) が一意:月末に cron が複数回走っても
-- 同じ月には1行しか残らない(upsert で上書き)。
create table public.net_worth_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,

  as_of                 date        not null,
  debt_balance_yen      bigint      not null,
  investment_value_yen  bigint      not null,

  created_at            timestamptz not null default now(),

  constraint ck_net_worth_debt_balance check (debt_balance_yen >= 0),
  constraint ck_net_worth_investment_value check (investment_value_yen >= 0)
);

create unique index ux_net_worth_snapshots_user_as_of
  on public.net_worth_snapshots (user_id, as_of);
create index ix_net_worth_snapshots_user_as_of_desc
  on public.net_worth_snapshots (user_id, as_of desc);

commit;
