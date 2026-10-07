-- =============================================================================
--  spending_promises に「これ以上は使わない」(per_week = 0)を許す(ADR-078)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20261007000100_spending_promises_stop.sql は実際に適用される正。
-- =============================================================================

begin;

alter table public.spending_promises drop constraint if exists ck_spending_promises_per_week;
alter table public.spending_promises
  add constraint ck_spending_promises_per_week check (per_week between 0 and 7);

commit;
