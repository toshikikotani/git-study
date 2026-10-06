-- =============================================================================
--  receipt_items へカテゴリを追加(本人発案:「品目もできれば分類したい」)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260922000300_receipt_items_category.sql は実際に適用される正。
-- =============================================================================

begin;

-- カテゴリ分割(transaction_splits)の対象になるかどうかに関わらず、品目
-- 単体にもカテゴリを付けられるようにする(ADR-035)。null のままでもよい
-- (分類できなかった・分類前の品目)。
alter table public.receipt_items
  add column if not exists category_id uuid references public.categories(id) on delete set null;

commit;
