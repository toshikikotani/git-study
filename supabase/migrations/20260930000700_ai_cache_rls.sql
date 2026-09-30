-- =============================================================================
--  ai_cache の Row Level Security(N1)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000700_ai_cache_rls.sql は実際に適用される正。
--  既存の RLS 一括適用(20260908000800_rls_and_seed.sql)は書き換えず、
--  新しいテーブル分だけをここで追加する(receipt_items と同じやり方)。
-- =============================================================================

begin;

alter table public.ai_cache enable row level security;
alter table public.ai_cache force row level security;

drop policy if exists "own_rows" on public.ai_cache;
create policy "own_rows" on public.ai_cache
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
