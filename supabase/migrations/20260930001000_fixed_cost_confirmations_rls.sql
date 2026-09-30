-- =============================================================================
--  fixed_cost_confirmations の Row Level Security(N4)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930001000_fixed_cost_confirmations_rls.sql は実際に適用される正。
-- =============================================================================

begin;

alter table public.fixed_cost_confirmations enable row level security;
alter table public.fixed_cost_confirmations force row level security;

drop policy if exists "own_rows" on public.fixed_cost_confirmations;
create policy "own_rows" on public.fixed_cost_confirmations
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
