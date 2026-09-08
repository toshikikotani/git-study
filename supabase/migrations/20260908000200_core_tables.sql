-- =============================================================================
--  設定・口座・カテゴリ・予算・負債・取り込み定義
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000200_core_tables.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- =============================================================================
--  3. テーブル定義
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 app_settings — 業務パラメータ(ADR-014)
--
--   秘密情報そのものは保存しない。環境変数の「参照名」のみを持つ(NFR-04)。
--   ユーザーあたり 1 行。user_id を主キーにすることで複数行を作れなくする。
-- -----------------------------------------------------------------------------
create table public.app_settings (
  user_id                             uuid primary key
                                        references auth.users(id) on delete cascade,

  -- 収支の前提(ADR-005:正確な値が判明するまでの仮置き)
  monthly_take_home_yen               bigint       not null default 250000,
  payday                              smallint     not null default 25,
  timezone                            text         not null default 'Asia/Tokyo',

  -- カテゴリ別の月次予算はここに置かない。categories.default_monthly_budget_yen と
  -- budgets テーブルが正(ADR-016)。設定側にも金額を持つと二重定義になり、
  -- 本人が片方だけ直したときに残額表示が静かにずれる。

  -- 返済・投資のルール(ADR-003, ADR-013)
  repayment_strategy                  repayment_strategy not null default 'avalanche',
  monthly_repayment_target_yen        bigint       not null default 100000,
  investment_ratio_of_repayment       numeric(4,3) not null default 0.200,
  side_income_repayment_ratio         numeric(4,3) not null default 0.700,  -- FR-42 返済7:投資3

  -- 完済後の切り替え(FR-52)
  is_high_risk_unlocked               boolean      not null default false,
  high_risk_allocation_ratio          numeric(4,3) not null default 0.300,

  -- アラート閾値(FR-20, FR-22)
  waste_alert_threshold               numeric(4,3) not null default 0.700,
  inactivity_alert_days               smallint     not null default 3,
  payment_due_reminder_days           smallint     not null default 1,

  -- AI 分類(ADR-010)
  classification_confidence_threshold numeric(4,3) not null default 0.800,
  classification_model                text         not null default 'claude-haiku-4-5-20251001',

  -- 朝配信(FR-30)
  brief_send_at                       time         not null default '07:00',
  brief_channel                       notification_channel not null default 'discord',

  -- 秘密情報は値ではなく参照名を保存する(ADR-014)
  discord_webhook_env_key             text         not null default 'DISCORD_WEBHOOK_URL',
  line_token_env_key                  text,

  created_at                          timestamptz  not null default now(),
  updated_at                          timestamptz  not null default now(),

  constraint ck_app_settings_payday
    check (payday between 1 and 31),
  constraint ck_app_settings_ratios
    check (investment_ratio_of_repayment between 0 and 1
       and side_income_repayment_ratio   between 0 and 1
       and high_risk_allocation_ratio    between 0 and 1
       and waste_alert_threshold         between 0 and 1
       and classification_confidence_threshold between 0 and 1),
  constraint ck_app_settings_amounts
    check (monthly_take_home_yen        >= 0
       and monthly_repayment_target_yen >= 0),
  constraint ck_app_settings_inactivity
    check (inactivity_alert_days between 1 and 30),
  -- 秘密情報が誤って値ごと入るのを防ぐ。ここに入るのは環境変数名だけ。
  constraint ck_app_settings_env_key_is_name
    check (discord_webhook_env_key !~ '^https?://'
       and (line_token_env_key is null or line_token_env_key !~ '^https?://'))
);

comment on table public.app_settings is
  '業務パラメータ。本人が設定画面または SQL で直接編集できる(NFR-02)。秘密情報は環境変数名のみを保持する。';


-- -----------------------------------------------------------------------------
-- 3.2 accounts — 口座・カード(仕様書 7章)
-- -----------------------------------------------------------------------------
create table public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid            not null references auth.users(id) on delete cascade,

  name                text            not null,
  institution_name    text,
  kind                account_kind    not null,
  purpose             account_purpose not null default 'other',

  currency            char(3)         not null default 'JPY',
  current_balance_yen bigint          not null default 0,
  balance_updated_on  date,

  -- クレジットカードの締め日・支払日(返済日リマインドと明細突合に使う)
  closing_day         smallint,
  payment_day         smallint,

  -- リボ・キャッシングの再発防止(13章):停止・解約済みのカードに印を付ける
  is_frozen           boolean         not null default false,
  frozen_reason       text,

  is_active           boolean         not null default true,
  sort_order          smallint        not null default 100,
  note                text,

  created_at          timestamptz     not null default now(),
  updated_at          timestamptz     not null default now(),

  constraint ck_accounts_name_not_blank check (btrim(name) <> ''),
  constraint ck_accounts_closing_day    check (closing_day is null or closing_day between 1 and 31),
  constraint ck_accounts_payment_day    check (payment_day is null or payment_day between 1 and 31),
  constraint ck_accounts_frozen_reason  check (not is_frozen or frozen_reason is not null)
);

create unique index ux_accounts_user_name on public.accounts (user_id, name);
create index ix_accounts_user_active      on public.accounts (user_id, is_active, sort_order);
create index ix_accounts_user_purpose     on public.accounts (user_id, purpose) where is_active;

comment on column public.accounts.is_frozen is
  'リボ・キャッシングの再発防止として停止・解約したカード。凍結済みカードに新規明細が発生した場合はアラート対象(13章)。';


-- -----------------------------------------------------------------------------
-- 3.3 categories — カテゴリ(FR-11, FR-13)
--
--   本人が自由に追加・変更・統廃合できることが要件(FR-13)。
--   統廃合を安全にするため、削除ではなく merged_into_id での付け替えを推奨する。
-- -----------------------------------------------------------------------------
create table public.categories (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid          not null references auth.users(id) on delete cascade,

  -- 安定した識別子。コード・ルール・シードから参照する。画面には出さない。
  code               text          not null,
  -- 表示名。画面に出るのは常にこの値で、本人が自由に変更してよい(FR-13, ADR-016)。
  -- アプリ側は名前で分岐してはならない。分岐は code と kind だけを見ること。
  name               text          not null,
  kind               category_kind not null,
  parent_id          uuid          references public.categories(id) on delete set null,

  -- 既定の月次予算。月ごとの上書きは budgets テーブル
  default_monthly_budget_yen bigint,

  color              text,
  sort_order         smallint      not null default 100,
  is_active          boolean       not null default true,

  -- ホーム画面に残額を出すカテゴリ(FR-14, FR-61)。
  -- どの枠を最上位に置くかは本人が決める。表示は sort_order の先頭2件まで。
  show_on_home       boolean       not null default false,

  -- 統廃合(FR-13):消さずに移行先を指す
  merged_into_id     uuid          references public.categories(id) on delete set null,

  -- システムが分岐に使うカテゴリ。削除・kind 変更を UI 側で抑止する目印
  is_system          boolean       not null default false,

  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),

  constraint ck_categories_code       check (code ~ '^[a-z0-9_]{1,40}$'),
  constraint ck_categories_name       check (btrim(name) <> ''),
  constraint ck_categories_budget     check (default_monthly_budget_yen is null
                                             or default_monthly_budget_yen >= 0),
  constraint ck_categories_not_self_parent check (parent_id is null or parent_id <> id),
  constraint ck_categories_not_self_merge  check (merged_into_id is null or merged_into_id <> id),
  -- 統合先が指定されたカテゴリは新規割り当ての対象外にする
  constraint ck_categories_merged_inactive check (merged_into_id is null or not is_active)
);

create unique index ux_categories_user_code on public.categories (user_id, code);
create index ix_categories_user_active      on public.categories (user_id, is_active, sort_order);
create index ix_categories_user_kind        on public.categories (user_id, kind);
create index ix_categories_parent           on public.categories (parent_id) where parent_id is not null;
-- ホームは毎回開かれる画面。表示対象だけを引く部分索引で小さく保つ。
create index ix_categories_show_on_home     on public.categories (user_id, sort_order)
  where show_on_home and is_active;

comment on column public.categories.name is
  '画面に出る表示名。本人がいつでも変更できる(FR-13)。アプリ側はこの値で分岐してはならない。';
comment on column public.categories.code is
  'コードとルールが参照する不変の識別子。画面には出さないため、表示名を変えてもここは変わらない。';
comment on column public.categories.show_on_home is
  'ホーム最上部に残額を出すか。どの枠を見たいかは本人が決める(FR-14, FR-61)。';


-- -----------------------------------------------------------------------------
-- 3.4 budgets — 月次予算(カテゴリ × 月)
-- -----------------------------------------------------------------------------
create table public.budgets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  category_id    uuid        not null references public.categories(id) on delete cascade,

  month          date        not null,  -- 必ず月初日(暦月:ADR-015)
  amount_yen     bigint      not null,
  carry_over_yen bigint      not null default 0,  -- 前月からの繰越(±)
  note           text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ck_budgets_month_is_first_day check (extract(day from month) = 1),
  constraint ck_budgets_amount             check (amount_yen >= 0)
);

create unique index ux_budgets_user_category_month
  on public.budgets (user_id, category_id, month);
create index ix_budgets_user_month on public.budgets (user_id, month desc);


-- -----------------------------------------------------------------------------
-- 3.5 debts — 借入(FR-01)
-- -----------------------------------------------------------------------------
create table public.debts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users(id) on delete cascade,

  lender_name         text        not null,
  kind                debt_kind   not null,
  account_id          uuid        references public.accounts(id) on delete set null,

  -- 金額(ADR-008:円単位)
  original_principal_yen bigint,
  current_balance_yen    bigint    not null,
  minimum_payment_yen    bigint    not null,

  -- 金利は小数で保持(15% → 0.1500)。ADR-008
  annual_rate         numeric(6,4) not null,

  payment_day         smallint     not null,
  status              debt_status  not null default 'active',

  -- ADR-006:正確な値が未把握のあいだ true。UI は「推定」バッジを出す
  is_estimated        boolean      not null default true,

  opened_on           date,
  balance_as_of       date         not null default public.today_jst(),
  paid_off_on         date,

  -- 借り換え(FR-04)で移行した場合の追跡
  refinanced_into_id  uuid         references public.debts(id) on delete set null,

  sort_order          smallint     not null default 100,
  note                text,

  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint ck_debts_lender_not_blank check (btrim(lender_name) <> ''),
  constraint ck_debts_balance          check (current_balance_yen >= 0),
  constraint ck_debts_minimum          check (minimum_payment_yen >= 0),
  constraint ck_debts_principal        check (original_principal_yen is null
                                              or original_principal_yen >= 0),
  -- 金利は 0〜100% の小数。1.5(=150%)のような桁間違いをここで止める
  constraint ck_debts_rate             check (annual_rate >= 0 and annual_rate <= 1),
  constraint ck_debts_payment_day      check (payment_day between 1 and 31),
  -- 完済しているのに残高が残っている、という矛盾を許さない
  constraint ck_debts_paid_off_zero    check (status <> 'paid_off' or current_balance_yen = 0),
  constraint ck_debts_paid_off_date    check ((status = 'paid_off') = (paid_off_on is not null)),
  constraint ck_debts_refinance_target check (refinanced_into_id is null or refinanced_into_id <> id),
  constraint ck_debts_refinanced_state check (refinanced_into_id is null or status = 'refinanced')
);

create index ix_debts_user_status  on public.debts (user_id, status);
create index ix_debts_user_active  on public.debts (user_id, annual_rate desc)
  where status = 'active';
create index ix_debts_payment_day  on public.debts (user_id, payment_day)
  where status = 'active';

comment on column public.debts.annual_rate is
  '年利を小数で保持する(15% → 0.1500)。パーセント値を入れると利息が100倍になるため CHECK で 1 以下に制限している。';
comment on column public.debts.is_estimated is
  '残高・金利が本人による実確認を経ていない推定値であることを示す。1件でも true が残るあいだ、完済予定日を確定値として表示してはならない(ADR-006)。';


-- -----------------------------------------------------------------------------
-- 3.6 import_adapters — CSV 列マッピング定義(ADR-007)
-- -----------------------------------------------------------------------------
create table public.import_adapters (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,

  name               text        not null,          -- 例:「楽天カード明細」
  account_id         uuid        references public.accounts(id) on delete set null,

  encoding           text        not null default 'auto',   -- auto / utf-8 / shift_jis
  delimiter          char(1)     not null default ',',
  skip_rows          smallint    not null default 0,
  has_header         boolean     not null default true,

  -- 列マッピング(0 始まりの列インデックス、またはヘッダ名)
  date_column        text        not null,
  description_column text        not null,
  amount_column      text,        -- 単一列に金額が入る形式
  amount_out_column  text,        -- 出金列(正の数で入る)
  amount_in_column   text,        -- 入金列(正の数で入る)
  balance_column     text,
  payment_method_column text,     -- 「支払区分」列があればリボ検知に使う

  -- 単一金額列の符号規約。カード明細は「利用金額」を正で出すことが多く、
  -- そのまま取り込むと支出が収入として集計される(ADR-008 の符号規約に反する)。
  --   as_is            : 列の符号をそのまま使う(銀行の入出金列など)
  --   expense_positive : 正の値を支出とみなして反転する(カード明細)
  amount_sign        text        not null default 'as_is',

  date_formats       text[]      not null default array['YYYY/MM/DD','YYYY-MM-DD','YYYYMMDD'],

  is_active          boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- 単一金額列か、出金/入金の2列か、どちらかは必ず定義されていること
  constraint ck_import_adapters_amount_mapping
    check (amount_column is not null
           or amount_out_column is not null
           or amount_in_column is not null),
  constraint ck_import_adapters_skip_rows check (skip_rows >= 0),
  constraint ck_import_adapters_amount_sign
    check (amount_sign in ('as_is', 'expense_positive')),
  -- 符号規約は単一金額列のときだけ意味を持つ。出金/入金の2列形式では
  -- どちらの列かで符号が決まるため、設定できてしまうと誤解のもとになる。
  constraint ck_import_adapters_amount_sign_scope
    check (amount_sign = 'as_is' or amount_column is not null)
);

create unique index ux_import_adapters_user_name on public.import_adapters (user_id, name);


-- -----------------------------------------------------------------------------
-- 3.7 import_batches — 取り込み単位(FR-10)
--
--   同一ファイルの二重取り込みを checksum のユニーク制約で防ぐ(ADR-007)。
-- -----------------------------------------------------------------------------
create table public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid               not null references auth.users(id) on delete cascade,

  source          transaction_source not null,
  account_id      uuid               references public.accounts(id) on delete set null,
  adapter_id      uuid               references public.import_adapters(id) on delete set null,

  file_name       text,
  checksum        text,              -- ファイル内容の SHA-256(16進)

  period_from     date,
  period_to       date,

  row_count       integer            not null default 0,
  imported_count  integer            not null default 0,
  duplicate_count integer            not null default 0,
  failed_count    integer            not null default 0,

  status          import_status      not null default 'pending',
  error_message   text,

  created_at      timestamptz        not null default now(),
  completed_at    timestamptz,

  constraint ck_import_batches_counts
    check (row_count >= 0 and imported_count >= 0
           and duplicate_count >= 0 and failed_count >= 0),
  constraint ck_import_batches_period
    check (period_from is null or period_to is null or period_from <= period_to),
  constraint ck_import_batches_checksum
    check (checksum is null or checksum ~ '^[0-9a-f]{64}$')
);

-- 同じファイルを二度取り込ませない
create unique index ux_import_batches_user_checksum
  on public.import_batches (user_id, checksum)
  where checksum is not null;
create index ix_import_batches_user_created
  on public.import_batches (user_id, created_at desc);


-- -----------------------------------------------------------------------------

commit;
