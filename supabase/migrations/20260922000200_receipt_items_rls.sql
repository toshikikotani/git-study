-- =============================================================================
--  receipt_items の Row Level Security(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260922000200_receipt_items_rls.sql は実際に適用される正。
--  既存の RLS 一括適用(20260908000800_rls_and_seed.sql)は書き換えず、
--  新しいテーブル分だけをここで追加する(ai_daily_reports と同じやり方)。
-- =============================================================================

begin;

alter table public.receipt_items enable row level security;
alter table public.receipt_items force row level security;

drop policy if exists "own_rows" on public.receipt_items;
create policy "own_rows" on public.receipt_items
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
