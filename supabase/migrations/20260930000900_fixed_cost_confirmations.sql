-- =============================================================================
--  固定費の確認(N4):検知した定期支払いの候補を、本人が固定費として確定する
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000900_fixed_cost_confirmations.sql は実際に適用される正。
--
--  - subscription_key: domain/subscriptions.ts の subscriptionKeyOf() と同じ
--    規則(正規化した店名/摘要 + 金額)で計算するキー。detectSubscriptions()の
--    検知結果と1対1で対応する。
-- =============================================================================

begin;

create table if not exists public.fixed_cost_confirmations (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  subscription_key text        not null,
  confirmed_at     timestamptz not null default now(),
  primary key (user_id, subscription_key)
);

commit;
