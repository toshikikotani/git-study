-- =============================================================================
--  receipt_item_genres の Row Level Security(本人発案、ADR-056)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260928000600_receipt_item_genres_rls.sql は実際に適用される正。
--  既存の RLS 一括適用(20260908000800_rls_and_seed.sql)は書き換えず、
--  新しいテーブル分だけをここで追加する(transaction_genres と同じやり方)。
-- =============================================================================

begin;

alter table public.receipt_item_genres enable row level security;
alter table public.receipt_item_genres force row level security;

drop policy if exists "own_rows" on public.receipt_item_genres;
create policy "own_rows" on public.receipt_item_genres
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
