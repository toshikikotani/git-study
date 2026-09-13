-- =============================================================================
--  Supabase Storage(receipts バケット)の Row Level Security(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正、7.1節)
--  この 20260913000400_receipt_storage_rls.sql は実際に適用される正。
--
--  receipts バケット自体はここでは作らない(Storage REST API で作る。
--  バケットの列構成はプラットフォームのバージョンで変わりうるため、SQL の
--  insert では触らない。features/import/receipt-storage.ts 参照)。
--  ここで固定するのはオブジェクトへのアクセス制御だけ。
--
--  パスは "{user_id}/{uuid}.拡張子" にすることを前提に、本人のフォルダだけ
--  読み書きできるようにする(Supabase 公式のフォルダ単位アクセス制御と同じ
--  パターン)。アップロードは本人のセッション(RLS 適用)で行うため、
--  ここが実際の砦になる(サービスロールキーでの管理者操作は RLS を素通しする
--  ため対象外)。
-- =============================================================================

begin;

alter table storage.objects enable row level security;

drop policy if exists "receipts_own_folder" on storage.objects;
create policy "receipts_own_folder" on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
