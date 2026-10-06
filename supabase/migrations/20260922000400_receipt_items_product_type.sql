-- =============================================================================
--  receipt_items へ商品分類(自由記述)を追加(本人発案、ADR-036)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260922000400_receipt_items_product_type.sql は実際に適用される正。
-- =============================================================================

begin;

-- 固定カテゴリ(category_id、ADR-035)とは別に、商品の種類そのものを
-- AIの自由記述で持たせる(例:飲料・調味料・菓子)。固定語彙を与えないため
-- enum ではなく text。null のままでもよい(判断できなかった品目)。
alter table public.receipt_items
  add column if not exists product_type text;

commit;
