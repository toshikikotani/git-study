-- =============================================================================
--  ai_monthly_reports の Row Level Security(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260921000400_ai_monthly_reports_rls.sql は実際に適用される正。
--  既存の RLS 一括適用(20260908000800_rls_and_seed.sql)は書き換えず、
--  新しいテーブル分だけをここで追加する(net_worth_snapshots・goals・
--  transaction_diagnoses と同じやり方)。
-- =============================================================================

begin;

alter table public.ai_monthly_reports enable row level security;
alter table public.ai_monthly_reports force row level security;

drop policy if exists "own_rows" on public.ai_monthly_reports;
create policy "own_rows" on public.ai_monthly_reports
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
