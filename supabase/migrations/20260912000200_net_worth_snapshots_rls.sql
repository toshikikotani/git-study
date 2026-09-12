-- =============================================================================
--  net_worth_snapshots の Row Level Security(P6-3)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260912000200_net_worth_snapshots_rls.sql は実際に適用される正。
--  既存の RLS 一括適用(20260908000800_rls_and_seed.sql)は書き換えず、
--  新しいテーブル分だけをここで追加する(rescued_emails と同じやり方)。
-- =============================================================================

begin;

alter table public.net_worth_snapshots enable row level security;
alter table public.net_worth_snapshots force row level security;

drop policy if exists "own_rows" on public.net_worth_snapshots;
create policy "own_rows" on public.net_worth_snapshots
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
