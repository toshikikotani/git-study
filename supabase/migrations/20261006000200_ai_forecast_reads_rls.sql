-- =============================================================================
--  ai_forecast_reads の Row Level Security(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20261006000200_ai_forecast_reads_rls.sql は実際に適用される正。
-- =============================================================================

begin;

alter table public.ai_forecast_reads enable row level security;
alter table public.ai_forecast_reads force row level security;

drop policy if exists "own_rows" on public.ai_forecast_reads;
create policy "own_rows" on public.ai_forecast_reads
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
