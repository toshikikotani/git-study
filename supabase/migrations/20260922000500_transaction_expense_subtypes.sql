-- =============================================================================
--  transaction_expense_subtypes — 生活費の小分類(本人発案、ADR-036)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260922000500_transaction_expense_subtypes.sql は実際に適用される正。
-- =============================================================================

begin;

-- 「生活費」カテゴリの明細が、具体的に何系の生活費か(食費・日用品・外食
-- など)をAIの自由記述で持たせる。transactions 本体に列を足すのではなく
-- 別テーブルにしたのは、receipt_items・transaction_splits と同じく、この
-- 値がレシート取り込みという1つの経路からしか今は生まれないため(通常の
-- CSV・メール取り込みでは値が無い)。1明細につき最大1行(再取り込み・
-- 再判定時は upsert で置き換える)。
create table public.transaction_expense_subtypes (
  transaction_id uuid        primary key references public.transactions(id) on delete cascade,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  subtype        text        not null,
  created_at     timestamptz not null default now(),

  constraint ck_transaction_expense_subtypes_not_blank check (btrim(subtype) <> '')
);

create index ix_transaction_expense_subtypes_user on public.transaction_expense_subtypes (user_id);

commit;
