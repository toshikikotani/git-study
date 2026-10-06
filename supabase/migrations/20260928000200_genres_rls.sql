-- =============================================================================
--  genres の Row Level Security(本人発案、ADR-056)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260928000200_genres_rls.sql は実際に適用される正。
--  既存の RLS 一括適用(20260908000800_rls_and_seed.sql)は書き換えず、
--  新しいテーブル分だけをここで追加する(transaction_diagnoses と同じやり方)。
-- =============================================================================

begin;

alter table public.genres enable row level security;
alter table public.genres force row level security;

drop policy if exists "own_rows" on public.genres;
create policy "own_rows" on public.genres
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
