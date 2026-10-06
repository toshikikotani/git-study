-- =============================================================================
--  transaction_diagnoses — 明細ごとの「浪費 か 必要経費 か」AI診断(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260921000100_transaction_diagnoses.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

create type spending_verdict as enum ('waste', 'necessary');

-- 3.25 transaction_diagnoses — 明細ごとの浪費/必要経費診断(本人発案、ADR-030)
-- -----------------------------------------------------------------------------
-- category_kind(浪費/生活費/聖域...)はカテゴリ単位の静的な分類で、同じ
-- カテゴリでも1件ごとの事情までは表さない。ここでは明細1件ごとに投資家目線で
-- AIが下した動的な評定を保存する。1明細につき1行(再診断は upsert で
-- 上書きする。過去の評定を履歴として重ねて残す機能ではない)。
create table public.transaction_diagnoses (
  id             uuid             primary key default gen_random_uuid(),
  user_id        uuid             not null references auth.users(id) on delete cascade,
  transaction_id uuid             not null references public.transactions(id) on delete cascade,

  verdict        spending_verdict not null,
  -- 投資家目線での判断理由。本人発案「客観視した分析」の要——ラベルだけでなく
  -- 理由が見えることで、本人が納得したり反論したりできる。
  reasoning      text             not null,

  created_at     timestamptz      not null default now(),

  constraint ck_transaction_diagnoses_reasoning_not_blank check (btrim(reasoning) <> '')
);

create unique index ux_transaction_diagnoses_transaction on public.transaction_diagnoses (transaction_id);
create index ix_transaction_diagnoses_user on public.transaction_diagnoses (user_id);

commit;
