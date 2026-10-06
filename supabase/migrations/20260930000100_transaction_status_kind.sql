-- =============================================================================
--  明細に status(実績/予定)と kind(通常/特別費)を追加し、分割の子の
--  「未分類」を親のジャンルへ揃える(家計簿の集計統一)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000100_transaction_status_kind.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--
--  - status: 'actual'(実績)| 'scheduled'(予定)。今日より未来の明細は予定として
--    実績の集計から外す。アプリは日付から実効の状態を導く(domain/ledger.ts の
--    entryStatus)ため、この列は保存時点の意図の記録+SQL 側から見るための値。
--  - kind: 'normal'(通常)| 'special'(特別費)。特別費は目標のペース計算から除く。
--  - 既存データ:未来日の明細は scheduled にする。分割・品目の子でジャンルが
--    未設定のものは、親のジャンルを引き継ぐ(親も未設定なら未分類のまま)。
-- =============================================================================

begin;

alter table public.transactions
  add column status text not null default 'actual',
  add column kind   text not null default 'normal',
  add constraint ck_transactions_status check (status in ('actual', 'scheduled')),
  add constraint ck_transactions_kind   check (kind in ('normal', 'special'));

-- 未来日(JST)の明細は予定。
update public.transactions
  set status = 'scheduled'
  where occurred_on > (now() at time zone 'Asia/Tokyo')::date;

-- 分割の子・品目のうち、ジャンル未設定のものを親のジャンルへ揃える。
update public.transaction_splits s
  set genre_id = t.genre_id
  from public.transactions t
  where s.transaction_id = t.id
    and s.genre_id is null
    and t.genre_id is not null;

update public.receipt_items i
  set genre_id = t.genre_id
  from public.transactions t
  where i.transaction_id = t.id
    and i.genre_id is null
    and t.genre_id is not null;

commit;
