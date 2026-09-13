-- =============================================================================
--  import_batches.receipt_image_path — レシート画像の保存先(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260913000300_import_batches_receipt_image.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- レシート撮影(source='manual')でだけ使う。Storage の receipts バケットの
-- オブジェクトキー({user_id}/{uuid}.拡張子)。1回の撮影=1バッチのため
-- import_batches に置く(1枚の写真に複数の買い物が写っていても同じ画像を
-- 指す。transactions 側に複製しない)。CSV・メールの取り込みでは常に null。
alter table public.import_batches
  add column receipt_image_path text;

commit;
