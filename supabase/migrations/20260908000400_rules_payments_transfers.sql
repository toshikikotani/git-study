-- =============================================================================
--  分類ルール・返済実績・シナリオ・振替
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000400_rules_payments_transfers.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.9 classification_rules — 分類ルール(FR-12, FR-13)
--
--   本人の修正結果をルールとして蓄積する。ルールが増えるほど AI 呼び出しが減り、
--   ランニングコストが逓減する(ADR-010)。
-- -----------------------------------------------------------------------------
create table public.classification_rules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid            not null references auth.users(id) on delete cascade,

  name              text            not null,
  priority          smallint        not null default 100,  -- 小さいほど先に評価
  match_type        rule_match_type not null,
  pattern           text,

  -- 適用範囲の絞り込み
  account_id        uuid            references public.accounts(id) on delete cascade,
  min_amount_yen    bigint,
  max_amount_yen    bigint,

  -- 付与する値
  category_id       uuid            references public.categories(id) on delete cascade,
  set_payment_method payment_method,
  set_merchant_name text,

  -- 由来(FR-12:本人の修正結果を学習データとして保持する)
  is_learned        boolean         not null default false,
  learned_from_transaction_id uuid  references public.transactions(id) on delete set null,

  hit_count         integer         not null default 0,
  last_hit_at       timestamptz,
  is_active         boolean         not null default true,

  created_at        timestamptz     not null default now(),
  updated_at        timestamptz     not null default now(),

  constraint ck_rules_name check (btrim(name) <> ''),
  -- 金額範囲のみのルール以外はパターンが必須
  constraint ck_rules_pattern_required
    check (match_type = 'amount_range' or (pattern is not null and btrim(pattern) <> '')),
  -- 金額範囲ルールは範囲が必須
  constraint ck_rules_amount_range_required
    check (match_type <> 'amount_range'
           or min_amount_yen is not null or max_amount_yen is not null),
  constraint ck_rules_amount_order
    check (min_amount_yen is null or max_amount_yen is null
           or min_amount_yen <= max_amount_yen),
  -- 何も設定しないルールは無意味
  constraint ck_rules_has_effect
    check (category_id is not null
           or set_payment_method is not null
           or set_merchant_name is not null),
  constraint ck_rules_hit_count check (hit_count >= 0)
);

-- 評価順に引く主経路
create index ix_rules_user_priority
  on public.classification_rules (user_id, priority, id)
  where is_active;
create index ix_rules_category on public.classification_rules (category_id);
-- 初期ルールの再投入を冪等にする(seed_defaults の ON CONFLICT 対象)
create unique index ux_rules_user_name on public.classification_rules (user_id, name);

-- 循環参照のため、transactions 側の FK はここで追加する
alter table public.transactions
  add constraint fk_transactions_matched_rule
  foreign key (matched_rule_id)
  references public.classification_rules(id) on delete set null;

create index ix_transactions_matched_rule
  on public.transactions (matched_rule_id)
  where matched_rule_id is not null;


-- -----------------------------------------------------------------------------
-- 3.10 debt_payments — 返済実績(FR-05)
-- -----------------------------------------------------------------------------
create table public.debt_payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  debt_id         uuid        not null references public.debts(id) on delete cascade,

  paid_on         date        not null,
  amount_yen      bigint      not null,
  principal_yen   bigint,
  interest_yen    bigint,

  balance_after_yen bigint,

  is_extra        boolean     not null default false,  -- 最低返済額を超える追加返済
  transaction_id  uuid        references public.transactions(id) on delete set null,
  note            text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ck_debt_payments_amount   check (amount_yen > 0),
  constraint ck_debt_payments_parts    check ((principal_yen is null) = (interest_yen is null)),
  -- 内訳が入っているなら合計が一致すること
  constraint ck_debt_payments_parts_sum
    check (principal_yen is null or principal_yen + interest_yen = amount_yen),
  constraint ck_debt_payments_nonneg
    check ((principal_yen is null or principal_yen >= 0)
           and (interest_yen is null or interest_yen >= 0)
           and (balance_after_yen is null or balance_after_yen >= 0))
);

create index ix_debt_payments_debt_paid on public.debt_payments (debt_id, paid_on desc);
create index ix_debt_payments_user_paid on public.debt_payments (user_id, paid_on desc);
-- 1件の明細を2件の返済に紐付ける事故を防ぐ
create unique index ux_debt_payments_transaction
  on public.debt_payments (transaction_id)
  where transaction_id is not null;


-- -----------------------------------------------------------------------------
-- 3.11 repayment_scenarios — 完済シミュレーションの保存(FR-02, FR-04)
--
--   計算自体は関数で行う(§5)。ここには本人が比較したい条件を保存する。
-- -----------------------------------------------------------------------------
create table public.repayment_scenarios (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid        not null references auth.users(id) on delete cascade,

  name                   text        not null,   -- 例:「月10万返済」「おまとめ年8%」
  strategy               repayment_strategy not null default 'avalanche',
  monthly_budget_yen     bigint,                 -- minimum 戦略では NULL
  -- FR-04 借り換えシミュレーション:全債務の金利をこの値に置き換えて計算する
  override_annual_rate   numeric(6,4),

  -- 計算結果のキャッシュ(表示の即時性のため)
  months_to_payoff       integer,
  payoff_on              date,
  total_interest_yen     bigint,
  total_paid_yen         bigint,
  computed_at            timestamptz,

  is_baseline            boolean     not null default false,  -- 比較の基準(最低返済のみ)
  sort_order             smallint    not null default 100,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ck_scenarios_name   check (btrim(name) <> ''),
  constraint ck_scenarios_budget check (monthly_budget_yen is null or monthly_budget_yen > 0),
  constraint ck_scenarios_budget_required
    check (strategy = 'minimum' or monthly_budget_yen is not null),
  constraint ck_scenarios_rate
    check (override_annual_rate is null
           or (override_annual_rate >= 0 and override_annual_rate <= 1))
);

create unique index ux_scenarios_user_name on public.repayment_scenarios (user_id, name);
-- 基準シナリオは1件だけ
create unique index ux_scenarios_baseline
  on public.repayment_scenarios (user_id)
  where is_baseline;


-- -----------------------------------------------------------------------------
-- 3.12 transfer_rules — 給料日振替ルール(FR-15)
-- -----------------------------------------------------------------------------
create table public.transfer_rules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid                 not null references auth.users(id) on delete cascade,

  name             text                 not null,   -- 例:「返済へ10万」
  trigger          transfer_trigger     not null default 'payday',
  execution_order  smallint             not null,   -- 返済→投資→女遊び→生活費(FR-15)

  from_account_id  uuid                 references public.accounts(id) on delete set null,
  to_account_id    uuid                 references public.accounts(id) on delete set null,
  debt_id          uuid                 references public.debts(id) on delete set null,
  category_id      uuid                 references public.categories(id) on delete set null,

  amount_type      transfer_amount_type not null,
  amount_yen       bigint,
  percentage       numeric(5,2),

  is_active        boolean              not null default true,
  note             text,

  created_at       timestamptz          not null default now(),
  updated_at       timestamptz          not null default now(),

  constraint ck_transfer_rules_name check (btrim(name) <> ''),
  -- 金額指定方式ごとに必要な列が埋まっていること
  constraint ck_transfer_rules_amount_shape check (
    (amount_type = 'fixed'      and amount_yen is not null and percentage is null)
    or (amount_type = 'percentage' and percentage is not null and amount_yen is null)
    or (amount_type = 'remainder'  and amount_yen is null and percentage is null)
  ),
  constraint ck_transfer_rules_amount_positive
    check (amount_yen is null or amount_yen > 0),
  constraint ck_transfer_rules_percentage
    check (percentage is null or (percentage > 0 and percentage <= 100)),
  constraint ck_transfer_rules_different_accounts
    check (from_account_id is null or to_account_id is null
           or from_account_id <> to_account_id)
);

create unique index ux_transfer_rules_user_name
  on public.transfer_rules (user_id, name);
create unique index ux_transfer_rules_order
  on public.transfer_rules (user_id, trigger, execution_order)
  where is_active;
-- 「残り全額」は契機ごとに1件まで
create unique index ux_transfer_rules_remainder
  on public.transfer_rules (user_id, trigger)
  where is_active and amount_type = 'remainder';


-- -----------------------------------------------------------------------------
-- 3.13 transfer_runs / transfer_run_items — 振替チェックリスト(FR-15)
--
--   「給料日に実行チェックリストを提示する」ための実行記録。
--   当日の意思決定を不要にするのが目的(設計原則4)。
-- -----------------------------------------------------------------------------
create table public.transfer_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid                not null references auth.users(id) on delete cascade,

  trigger        transfer_trigger    not null,
  run_on         date                not null,
  source_amount_yen bigint           not null,   -- 振り分け元の入金額
  status         transfer_run_status not null default 'pending',
  completed_at   timestamptz,

  created_at     timestamptz         not null default now(),
  updated_at     timestamptz         not null default now(),

  constraint ck_transfer_runs_amount check (source_amount_yen > 0),
  constraint ck_transfer_runs_completed
    check ((status = 'completed') = (completed_at is not null))
);

create unique index ux_transfer_runs_user_trigger_date
  on public.transfer_runs (user_id, trigger, run_on);
create index ix_transfer_runs_pending
  on public.transfer_runs (user_id, run_on desc)
  where status = 'pending';

create table public.transfer_run_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  run_id            uuid        not null references public.transfer_runs(id) on delete cascade,
  rule_id           uuid        references public.transfer_rules(id) on delete set null,

  execution_order   smallint    not null,
  label             text        not null,       -- ルール名のスナップショット
  planned_amount_yen bigint     not null,
  actual_amount_yen  bigint,

  is_done           boolean     not null default false,
  done_at           timestamptz,
  transaction_id    uuid        references public.transactions(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint ck_transfer_items_planned check (planned_amount_yen >= 0),
  constraint ck_transfer_items_actual  check (actual_amount_yen is null or actual_amount_yen >= 0),
  constraint ck_transfer_items_done    check (is_done = (done_at is not null))
);

create unique index ux_transfer_run_items_order
  on public.transfer_run_items (run_id, execution_order);
create index ix_transfer_run_items_run on public.transfer_run_items (run_id);


-- -----------------------------------------------------------------------------

commit;
