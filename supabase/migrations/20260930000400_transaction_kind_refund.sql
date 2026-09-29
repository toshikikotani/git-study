-- =============================================================================
--  返品・返金(kind='refund')を追加する(カテゴリ詳細 P5)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000400_transaction_kind_refund.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--
--  - kind: 'normal'(通常)| 'special'(特別費)| 'refund'(返品・返金)。
--    返品・返金は金額が正で、収入ではなくそのジャンルの支出から差し引く
--    (domain/ledger.ts の summarizeLedger)。既存の明細は変わらない。
-- =============================================================================

begin;

alter table public.transactions drop constraint if exists ck_transactions_kind;
alter table public.transactions
  add constraint ck_transactions_kind check (kind in ('normal', 'special', 'refund'));

commit;
