-- =============================================================================
--  receipt_items — レシートの品目(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260922000100_receipt_items.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.28 receipt_items — レシートの品目(本人発案、ADR-034)
-- -----------------------------------------------------------------------------
-- 「レシートというのは店と品目を全て合わせた概念」という指摘への対応。
-- transaction_splits(カテゴリ分割、2件以上・合計一致が必須)とは別物——
-- こちらは「何を買ったか」を常に残す記録で、1点だけの買い物でも、
-- 内訳の合計が支払額と一致しなくても保存する。カテゴリ分割の対象になるか
-- どうかに関わらず、レシートに商品行が写っていた明細には必ず付く。
create table public.receipt_items (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  transaction_id uuid        not null references public.transactions(id) on delete cascade,

  name           text        not null,
  amount_yen     bigint      not null,
  sort_order     smallint    not null default 0,

  created_at     timestamptz not null default now(),

  constraint ck_receipt_items_name_not_blank check (btrim(name) <> ''),
  constraint ck_receipt_items_amount_nonzero check (amount_yen <> 0)
);

create index ix_receipt_items_transaction on public.receipt_items (transaction_id, sort_order);
create index ix_receipt_items_user on public.receipt_items (user_id);

commit;
