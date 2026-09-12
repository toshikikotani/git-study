-- =============================================================================
--  rescued_emails の Row Level Security(T-11)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908001300_rescued_emails_rls.sql は実際に適用される正。
--  既存の RLS 一括適用(20260908000800_rls_and_seed.sql)は書き換えず、
--  新しいテーブル分だけをここで追加する。
-- =============================================================================

begin;

alter table public.rescued_emails enable row level security;
alter table public.rescued_emails force row level security;

drop policy if exists "own_rows" on public.rescued_emails;
create policy "own_rows" on public.rescued_emails
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
