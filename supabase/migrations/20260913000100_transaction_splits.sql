-- =============================================================================
--  transaction_splits — 明細の複数カテゴリ分割(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260913000100_transaction_splits.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.23 transaction_splits — 明細の複数カテゴリ分割
-- -----------------------------------------------------------------------------
-- 1件の明細(スーパーのレシートなど)を複数のカテゴリに配分できるようにする。
-- transactions.category_id はそのまま残す(分割していない明細が大多数のため、
-- 単純な参照を崩さない)。分割がある明細だけ、この表の行の合計で
-- transactions.amount_yen を置き換える(合計が一致することはアプリ側
-- (domain/transaction-splits.ts の assertValidSplits())で保証する。
-- 複数行にまたがる合計チェックは CHECK 制約では表現できないため)。
create table public.transaction_splits (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  transaction_id uuid        not null references public.transactions(id) on delete cascade,
  category_id    uuid        references public.categories(id) on delete set null,

  amount_yen     bigint      not null,
  note           text,

  created_at     timestamptz not null default now(),

  constraint ck_transaction_splits_amount_nonzero check (amount_yen <> 0)
);

create index ix_transaction_splits_transaction on public.transaction_splits (transaction_id);
create index ix_transaction_splits_user on public.transaction_splits (user_id);

commit;
