-- =============================================================================
--  spending_promises の Row Level Security(ADR-075)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20261006000400_spending_promises_rls.sql は実際に適用される正。
-- =============================================================================

begin;

alter table public.spending_promises enable row level security;
alter table public.spending_promises force row level security;

drop policy if exists "own_rows" on public.spending_promises;
create policy "own_rows" on public.spending_promises
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
