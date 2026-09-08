-- =============================================================================
--  個人資産形成システム(仮称) — Supabase / PostgreSQL スキーマ
--  要求仕様書 v0.1 7章「データモデル(概略)」の詳細設計
--
--  対象      : PostgreSQL 15+ (Supabase)
--  文字コード: UTF-8
--  生成日    : 2026-09-08
--
--  設計方針(docs/decisions.md 参照)
--    ADR-008 金額は bigint の円単位・符号付き(支出が負、収入が正)
--            金利は numeric(6,4) の小数(15% → 0.1500)
--    ADR-011 シングルユーザーだが auth.users を使い、全テーブルに
--            user_id + RLS を張る。将来の複数ユーザー化を列1本で吸収する
--    ADR-014 業務パラメータは app_settings に置き、コードに直書きしない
--    ADR-015 日時は timestamptz(UTC保存)、「今日」の判定は public.today_jst()
--
--  命名規約
--    テーブル : 複数形スネークケース
--    金額     : *_yen
--    日付     : *_on(date)  / 日時: *_at(timestamptz)
--    真偽値   : is_* / has_*
--    制約     : ck_<table>_<内容> / ux_<table>_<列> / ix_<table>_<列>
--
--  適用順序(このファイルは冪等ではない。初回構築用)
--    supabase/migrations/ へ分割して配置する運用は docs/architecture.md 参照
-- =============================================================================

begin;

-- =============================================================================
--  0. 拡張
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;  -- gen_random_uuid()
create extension if not exists "pg_trgm"  with schema extensions;  -- 摘要の部分一致検索

-- pg_cron は自身の control file で schema = cron が指定されているため、
-- with schema は付けられない。オブジェクトは cron スキーマに作られる。
create extension if not exists "pg_cron";  -- 無料枠の自動停止回避(NFR-05)


-- =============================================================================
--  1. ENUM 型
--
--  「本人が自由に追加・変更できる」ことが要件の分類(カテゴリ)はテーブルで持ち、
--  システムの分岐ロジックが依存する安定した定義域のみ ENUM にする(設計原則1・6)。
-- =============================================================================

-- 口座・カードの種別
create type account_kind as enum (
  'bank',           -- 銀行口座
  'credit_card',    -- クレジットカード
  'cash',           -- 現金
  'securities',     -- 証券口座
  'e_money',        -- 電子マネー・コード決済
  'other'
);

-- 口座の用途(仕様書 7章 accounts:用途=給与/返済/投資/女遊び/生活費)
create type account_purpose as enum (
  'salary',         -- 給与受取
  'repayment',      -- 返済
  'investment',     -- 投資
  'sanctuary',      -- 聖域支出(女遊び枠)
  'living',         -- 生活費
  'emergency',      -- 生活防衛資金
  'other'
);

-- 借入の種別(FR-01)
create type debt_kind as enum (
  'revolving',        -- リボ払い
  'cashing',          -- キャッシング
  'installment',      -- 分割払い
  'card_loan',        -- カードローン
  'consumer_finance', -- 消費者金融
  'bank_loan',        -- 銀行ローン
  'other'
);

create type debt_status as enum (
  'active',
  'paid_off',
  'refinanced',   -- 借り換えにより別債務へ移行
  'closed'        -- 誤登録などによる無効化
);

-- カテゴリの性質。予算・残額計算・アラート判定の分岐がこれに依存する(FR-11)
create type category_kind as enum (
  'fixed_cost',           -- 固定費
  'living',               -- 生活費
  'sanctuary',            -- 聖域(女遊び) — 削減対象外、肯定形で残額表示(FR-64)
  'waste',                -- 浪費 — 70%到達でアラート(FR-20)
  'investment_spending',  -- 投資的支出(書籍・学習など)
  'repayment',            -- 返済
  'investment',           -- 投資
  'income',               -- 収入
  'transfer',             -- 口座間振替(収支に計上しない)
  'other'
);

-- 明細の取り込み元(FR-10)
create type transaction_source as enum (
  'csv',
  'gmail',
  'manual',
  'api'
);

-- 支払方法。FR-21(リボ・キャッシング・分割の即時検知)の判定対象
create type payment_method as enum (
  'one_time',    -- 一括払い
  'revolving',   -- リボ払い        ← 検知対象
  'cashing',     -- キャッシング    ← 検知対象
  'installment', -- 分割払い        ← 検知対象
  'debit',
  'transfer',
  'unknown'
);

-- 誰が分類したか(FR-12)
create type classified_by as enum (
  'unclassified',
  'rule',    -- classification_rules によるマッチ
  'ai',      -- Claude による分類
  'manual'   -- 本人による指定・修正
);

-- 本人確認の状態(FR-12:確信度が低いもののみ確認を求める)
create type review_status as enum (
  'auto_ok',    -- 確信度が閾値以上。確認不要
  'pending',    -- 本人確認待ち
  'confirmed',  -- 本人が「これで正しい」と確認
  'corrected',  -- 本人が修正した(学習データとして重要)
  'ignored'     -- 対象外として除外
);

-- 分類ルールのマッチ方式(FR-13)
create type rule_match_type as enum (
  'keyword',       -- 部分一致
  'regex',         -- 正規表現
  'exact',         -- 完全一致
  'amount_range',  -- 金額範囲のみで判定
  'merchant'       -- 正規化済み店名の完全一致
);

-- 振替ルールの金額指定方式(FR-15)
create type transfer_amount_type as enum (
  'fixed',       -- 定額
  'percentage',  -- 入金額に対する割合
  'remainder'    -- 残り全額(順序の最後に1件だけ置ける)
);

-- 振替ルールの発火契機
create type transfer_trigger as enum (
  'payday',       -- 給料日
  'side_income',  -- 副業入金時(FR-42)
  'manual'
);

create type transfer_run_status as enum (
  'pending',    -- チェックリスト提示済み・未完了
  'completed',
  'skipped'
);

-- アラートの種類(P2)
create type alert_kind as enum (
  'waste_budget_70',      -- FR-20 浪費が月予算の70%到達
  'budget_exceeded',      -- 予算超過
  'revolving_detected',   -- FR-21 リボ払い検知
  'cashing_detected',     -- FR-21 キャッシング検知
  'installment_detected', -- FR-21 分割払い検知
  'inactivity',           -- FR-22 3日以上の未取り込み・未確認
  'payment_due',          -- FR-23 返済日の前日
  'import_needed',        -- 明細取り込みの催促
  'job_failure',          -- NFR-06 ジョブ失敗
  'debt_paid_off',        -- 完済検知(FR-52 の高リスク枠解禁トリガー)
  'other'
);

create type alert_severity as enum ('info', 'warn', 'critical');

create type alert_status as enum (
  'pending',
  'sent',
  'failed',
  'acknowledged',
  'suppressed'   -- 重複などにより送信を抑止
);

create type notification_channel as enum ('discord', 'line', 'email', 'none');

-- 朝配信(P3)
create type brief_status as enum ('pending', 'generated', 'delivered', 'failed');

create type brief_item_kind as enum (
  'headline',    -- 完済まで残り日数 / 使える残額(FR-30-1:必ず冒頭)
  'income_tip',  -- 収入増のヒント(FR-30-2)
  'market',      -- 市場の話題(FR-30-3)
  'campaign'     -- キャンペーン・還元(FR-30-4)
);

-- FR-31 のフィルタ除外理由。「除外理由をログに残す」ための定義域
create type brief_exclusion_reason as enum (
  'info_product',       -- 情報商材
  'unverified_income',  -- 根拠不明な高収入案件
  'suspected_scam',     -- 詐欺性が疑われる
  'affiliate_primary',  -- アフィリエイト目的が主
  'no_evidence',        -- 一次情報が確認できない
  'expired',            -- 期限切れ
  'duplicate',
  'off_topic',
  'other'
);

-- バッチ実行(NFR-06)
create type job_status as enum ('running', 'succeeded', 'failed', 'cancelled');

create type job_trigger_source as enum ('github_actions', 'pg_cron', 'manual', 'webhook');

create type import_status as enum ('pending', 'succeeded', 'partial', 'failed');

-- 転職準備(FR-41)
create type milestone_phase as enum ('research', 'resume', 'apply', 'interview', 'offer');

create type milestone_status as enum ('todo', 'doing', 'done', 'dropped');

-- 返済戦略(ADR-013)
create type repayment_strategy as enum (
  'avalanche',  -- 高金利優先(既定)
  'snowball',   -- 少額優先
  'minimum',    -- 最低返済のみ(FR-02 の比較対象)
  'custom'
);


-- =============================================================================
--  2. 共通関数
-- =============================================================================

-- ADR-015: 「今日」は必ず JST で判定する。current_date を直接使わないこと。
create or replace function public.today_jst()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Asia/Tokyo')::date;
$$;

comment on function public.today_jst() is
  'JST における今日の日付。Vercel(UTC)と本人の端末(JST)で日付がずれるのを防ぐため、日付判定は必ずこの関数を経由する。';

-- 当月初日(JST)。予算・集計の月区切りは暦月(ADR-015)
create or replace function public.month_start_jst(p_offset_months int default 0)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (date_trunc('month', public.today_jst())
          + make_interval(months => p_offset_months))::date;
$$;

-- updated_at の自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


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

  -- Gmail 自動取得(ADR-018)。資格情報は環境変数に置き、ここには条件だけを持つ。
  -- gmail_enabled が false でも設定は残す。止めたい月に消す必要はない。
  gmail_enabled                       boolean      not null default false,
  -- 対象とする差出人。空配列なら受信箱全体を解析にかける。
  gmail_from_addresses                text[]       not null default '{}',
  -- 前回どこまで読んだか。ここから先だけを取りに行く。
  gmail_last_synced_on                date,
  -- 1回の実行で読む上限。初回に受信箱を全部読まないための歯止め。
  gmail_fetch_limit                   smallint     not null default 200,

  -- 秘密情報は値ではなく参照名を保存する(ADR-014)
  discord_webhook_env_key             text         not null default 'DISCORD_WEBHOOK_URL',
  line_token_env_key                  text,
  gmail_address_env_key               text         not null default 'GMAIL_ADDRESS',
  gmail_app_password_env_key          text         not null default 'GMAIL_APP_PASSWORD',

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
  constraint ck_app_settings_gmail_limit
    check (gmail_fetch_limit between 1 and 1000),
  -- 秘密情報が誤って値ごと入るのを防ぐ。ここに入るのは環境変数名だけ。
  constraint ck_app_settings_env_key_is_name
    check (discord_webhook_env_key !~ '^https?://'
       and (line_token_env_key is null or line_token_env_key !~ '^https?://')
       -- アプリパスワードそのものが入るのを防ぐ。ここに入るのは環境変数名だけ。
       and gmail_app_password_env_key ~ '^[A-Z][A-Z0-9_]*$'
       and gmail_address_env_key      ~ '^[A-Z][A-Z0-9_]*$')
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
-- 3.8 transactions — 取引明細(FR-10〜FR-14)
--
--   本システムで最も行数が増えるテーブル。索引設計はここが要。
--   ADR-008: amount_yen は符号付き(支出が負、収入が正)
-- -----------------------------------------------------------------------------
create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid               not null references auth.users(id) on delete cascade,
  account_id        uuid               not null references public.accounts(id) on delete restrict,

  occurred_on       date               not null,   -- 利用日
  posted_on         date,                          -- 計上日(カードの請求確定日)

  amount_yen        bigint             not null,   -- 支出が負、収入が正
  is_expense        boolean            generated always as (amount_yen < 0) stored,

  description       text               not null,   -- 摘要(生データ)
  merchant_name     text,                          -- 正規化した店名

  -- 取り込み情報
  source            transaction_source not null,
  source_ref        text,                          -- Gmail の message-id など外部一意キー
  import_batch_id   uuid               references public.import_batches(id) on delete set null,
  raw               jsonb,                         -- 元データ全体を保持(再解析用)

  -- 重複排除キー。トリガで自動生成する(ADR-007)
  fingerprint       text               not null,

  -- 分類(FR-11, FR-12)
  category_id       uuid               references public.categories(id) on delete set null,
  classified_by     classified_by      not null default 'unclassified',
  confidence        numeric(4,3),
  matched_rule_id   uuid,                          -- FK は classification_rules 定義後に追加
  review_status     review_status      not null default 'pending',
  reviewed_at       timestamptz,

  -- FR-21 の判定対象。AI ではなく決定的なルールで埋める(ADR-010)
  payment_method    payment_method     not null default 'unknown',

  -- 口座間振替は収支に計上しない
  is_transfer       boolean            not null default false,
  counter_transaction_id uuid          references public.transactions(id) on delete set null,

  note              text,
  created_at        timestamptz        not null default now(),
  updated_at        timestamptz        not null default now(),

  -- 0円明細は取り込みミス
  constraint ck_transactions_amount_nonzero check (amount_yen <> 0),
  constraint ck_transactions_description    check (btrim(description) <> ''),
  constraint ck_transactions_confidence     check (confidence is null
                                                   or confidence between 0 and 1),
  -- AI が分類したなら確信度が必ずある。無いまま閾値判定に流れる事故を防ぐ
  constraint ck_transactions_ai_needs_confidence
    check (classified_by <> 'ai' or confidence is not null),
  -- 分類済みならカテゴリがある
  constraint ck_transactions_classified_has_category
    check (classified_by = 'unclassified' or category_id is not null),
  -- 本人が確認・修正したなら日時が残る(学習データの根拠)
  constraint ck_transactions_reviewed_at
    check (review_status not in ('confirmed','corrected') or reviewed_at is not null),
  constraint ck_transactions_not_self_counter
    check (counter_transaction_id is null or counter_transaction_id <> id),
  constraint ck_transactions_posted_after_occurred
    check (posted_on is null or posted_on >= occurred_on)
);

-- 重複排除:同一ファイルを別名で取り込んでも同じ明細は入らない
create unique index ux_transactions_fingerprint
  on public.transactions (user_id, fingerprint);

-- Gmail の message-id など、外部の一意キーがある場合の重複排除
create unique index ux_transactions_source_ref
  on public.transactions (user_id, source, source_ref)
  where source_ref is not null;

-- 一覧・月次集計の主経路
create index ix_transactions_user_occurred
  on public.transactions (user_id, occurred_on desc);
create index ix_transactions_user_category_occurred
  on public.transactions (user_id, category_id, occurred_on desc);
create index ix_transactions_account_occurred
  on public.transactions (account_id, occurred_on desc);

-- FR-12:本人確認待ちの明細だけを引く。部分索引で小さく保つ
create index ix_transactions_pending_review
  on public.transactions (user_id, occurred_on desc)
  where review_status = 'pending';

-- FR-21:リボ・キャッシング・分割の検知。ここは即時性が要るので専用の部分索引
create index ix_transactions_risky_payment
  on public.transactions (user_id, occurred_on desc)
  where payment_method in ('revolving', 'cashing', 'installment');

-- 未分類の掃き出し
create index ix_transactions_unclassified
  on public.transactions (user_id, occurred_on desc)
  where classified_by = 'unclassified';

-- 摘要の全文検索(明細を探す用途)
create index ix_transactions_description_trgm
  on public.transactions using gin (description extensions.gin_trgm_ops);

comment on column public.transactions.amount_yen is
  '符号付きの円。支出が負、収入が正。SUM() だけで収支が出る。集計時に CASE を書かせない(ADR-008)。';
comment on column public.transactions.classified_by is
  '「カテゴリを誰が決めたか」を表す。支払方法だけを設定するルール(リボ検知など)は
   カテゴリを付けないため、この列を変更しない。unclassified 以外はカテゴリ必須。';
comment on column public.transactions.fingerprint is
  '口座・日付・金額・正規化した摘要から生成する重複排除キー。トリガ trg_transactions_fingerprint が自動設定する。';


-- 重複排除キーの自動生成
create or replace function public.set_transaction_fingerprint()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fingerprint := md5(
    coalesce(new.account_id::text, '')                                   || '|' ||
    to_char(new.occurred_on, 'YYYYMMDD')                                 || '|' ||
    new.amount_yen::text                                                 || '|' ||
    lower(regexp_replace(coalesce(new.description, ''), '[[:space:]]', '', 'g'))
  );
  return new;
end;
$$;

create trigger trg_transactions_fingerprint
  before insert or update of account_id, occurred_on, amount_yen, description
  on public.transactions
  for each row execute function public.set_transaction_fingerprint();


-- -----------------------------------------------------------------------------
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
-- 3.14 side_projects / side_work_logs / side_incomes — 副業(FR-40, FR-42)
--
--   仕様書 7章では side_income_logs 1本だが、作業時間と入金は発生タイミングも
--   粒度も異なる。時給換算(FR-40)を正しく出すため分離する。
-- -----------------------------------------------------------------------------
create table public.side_projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,

  name         text        not null,
  client_name  text,
  kind         text,                      -- 受託 / 自社サービス / 記事 など
  is_active    boolean     not null default true,
  started_on   date,
  ended_on     date,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint ck_side_projects_name   check (btrim(name) <> ''),
  constraint ck_side_projects_period check (ended_on is null or started_on is null
                                            or ended_on >= started_on)
);

create unique index ux_side_projects_user_name on public.side_projects (user_id, name);

create table public.side_work_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  project_id  uuid          not null references public.side_projects(id) on delete cascade,

  worked_on   date          not null,
  minutes     integer       not null,
  summary     text,

  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),

  constraint ck_side_work_minutes check (minutes > 0 and minutes <= 1440)
);

create index ix_side_work_logs_project_date on public.side_work_logs (project_id, worked_on desc);
create index ix_side_work_logs_user_date    on public.side_work_logs (user_id, worked_on desc);

create table public.side_incomes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  project_id     uuid        references public.side_projects(id) on delete set null,

  received_on    date        not null,
  amount_yen     bigint      not null,
  account_id     uuid        references public.accounts(id) on delete set null,
  transaction_id uuid        references public.transactions(id) on delete set null,

  -- FR-42 振り分け(返済7:投資3)
  allocated_to_repayment_yen bigint,
  allocated_to_investment_yen bigint,
  transfer_run_id uuid       references public.transfer_runs(id) on delete set null,

  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ck_side_incomes_amount check (amount_yen > 0),
  constraint ck_side_incomes_alloc
    check ((allocated_to_repayment_yen is null) = (allocated_to_investment_yen is null)),
  constraint ck_side_incomes_alloc_sum
    check (allocated_to_repayment_yen is null
           or allocated_to_repayment_yen + allocated_to_investment_yen <= amount_yen),
  constraint ck_side_incomes_alloc_nonneg
    check ((allocated_to_repayment_yen is null or allocated_to_repayment_yen >= 0)
           and (allocated_to_investment_yen is null or allocated_to_investment_yen >= 0))
);

create index ix_side_incomes_user_date on public.side_incomes (user_id, received_on desc);


-- -----------------------------------------------------------------------------
-- 3.15 job_change_milestones — 転職準備チェックリスト(FR-41)
-- -----------------------------------------------------------------------------
create table public.job_change_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid             not null references auth.users(id) on delete cascade,

  phase       milestone_phase  not null,
  title       text             not null,
  status      milestone_status not null default 'todo',
  sort_order  smallint         not null default 100,

  due_on      date,
  done_on     date,
  note        text,

  created_at  timestamptz      not null default now(),
  updated_at  timestamptz      not null default now(),

  constraint ck_milestones_title check (btrim(title) <> ''),
  constraint ck_milestones_done  check ((status = 'done') = (done_on is not null))
);

create index ix_milestones_user_phase on public.job_change_milestones (user_id, phase, sort_order);


-- -----------------------------------------------------------------------------
-- 3.16 investment_contributions / investment_snapshots — 投資(FR-50, FR-51)
--
--   仕様書 7章の investments を「拠出(フロー)」と「残高(ストック)」に分ける。
--   時価は変動するため、残高は時点スナップショットとして持つのが正しい。
-- -----------------------------------------------------------------------------
create table public.investment_contributions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  account_id     uuid        references public.accounts(id) on delete set null,

  contributed_on date        not null,
  amount_yen     bigint      not null,
  product_name   text,                        -- 例:eMAXIS Slim 全世界株式
  is_high_risk   boolean     not null default false,   -- FR-52 の高リスク枠
  transaction_id uuid        references public.transactions(id) on delete set null,
  note           text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ck_contributions_amount check (amount_yen > 0)
);

create index ix_contributions_user_date
  on public.investment_contributions (user_id, contributed_on desc);

create table public.investment_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  account_id     uuid        references public.accounts(id) on delete set null,

  as_of          date        not null,
  market_value_yen bigint    not null,
  cost_basis_yen bigint,
  product_name   text,

  created_at     timestamptz not null default now(),

  constraint ck_snapshots_value check (market_value_yen >= 0),
  constraint ck_snapshots_cost  check (cost_basis_yen is null or cost_basis_yen >= 0)
);

create unique index ux_snapshots_user_account_product_date
  on public.investment_snapshots (user_id, coalesce(account_id::text, ''),
                                  coalesce(product_name, ''), as_of);
create index ix_snapshots_user_date on public.investment_snapshots (user_id, as_of desc);


-- -----------------------------------------------------------------------------
-- 3.17 job_runs — バッチ実行ログ(NFR-06)
-- -----------------------------------------------------------------------------
create table public.job_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid               not null references auth.users(id) on delete cascade,

  job_name        text               not null,   -- morning_brief / detect_alerts / keepalive など
  status          job_status         not null default 'running',
  trigger_source  job_trigger_source not null,

  started_at      timestamptz        not null default now(),
  finished_at     timestamptz,
  duration_ms     integer,

  items_processed integer            not null default 0,
  error_message   text,
  detail          jsonb,

  constraint ck_job_runs_name     check (btrim(job_name) <> ''),
  constraint ck_job_runs_finished check ((status = 'running') = (finished_at is null)),
  constraint ck_job_runs_error    check (status <> 'failed' or error_message is not null),
  constraint ck_job_runs_items    check (items_processed >= 0)
);

create index ix_job_runs_name_started on public.job_runs (job_name, started_at desc);
create index ix_job_runs_failed
  on public.job_runs (user_id, started_at desc)
  where status = 'failed';


-- -----------------------------------------------------------------------------
-- 3.18 daily_briefs / brief_items / brief_excluded_items — 朝配信(P3)
-- -----------------------------------------------------------------------------
create table public.daily_briefs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid         not null references auth.users(id) on delete cascade,

  brief_on              date         not null,
  status                brief_status not null default 'pending',

  -- FR-30-1:冒頭に必ず載せる2つの数字。生成時点の値をスナップショットする
  days_to_payoff        integer,
  remaining_debt_yen    bigint,
  spendable_living_yen  bigint,
  spendable_sanctuary_yen bigint,

  body_md               text,
  channel               notification_channel not null default 'discord',

  model                 text,
  input_tokens          integer,
  output_tokens         integer,

  job_run_id            uuid         references public.job_runs(id) on delete set null,
  generated_at          timestamptz,
  delivered_at          timestamptz,
  error_message         text,

  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now(),

  constraint ck_briefs_delivered check ((status = 'delivered') = (delivered_at is not null)),
  constraint ck_briefs_failed    check (status <> 'failed' or error_message is not null),
  constraint ck_briefs_tokens    check ((input_tokens is null or input_tokens >= 0)
                                        and (output_tokens is null or output_tokens >= 0))
);

create unique index ux_briefs_user_date on public.daily_briefs (user_id, brief_on);
create index ix_briefs_user_date        on public.daily_briefs (user_id, brief_on desc);

create table public.brief_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid            not null references auth.users(id) on delete cascade,
  brief_id    uuid            not null references public.daily_briefs(id) on delete cascade,

  kind        brief_item_kind not null,
  sort_order  smallint        not null default 100,

  title       text            not null,
  summary     text,
  url         text,
  source_name text,

  -- FR-30-4:期限・条件・得の大きさを明記し優先度付けする
  priority    smallint,
  benefit_yen bigint,
  conditions  text,
  expires_on  date,

  created_at  timestamptz     not null default now(),

  constraint ck_brief_items_title    check (btrim(title) <> ''),
  constraint ck_brief_items_priority check (priority is null or priority between 1 and 5),
  constraint ck_brief_items_url      check (url is null or url ~ '^https?://')
);

create index ix_brief_items_brief on public.brief_items (brief_id, kind, sort_order);

-- FR-31:除外理由を必ず記録する
create table public.brief_excluded_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid                   not null references auth.users(id) on delete cascade,
  brief_id      uuid                   not null references public.daily_briefs(id) on delete cascade,

  title         text                   not null,
  url           text,
  source_name   text,
  reason        brief_exclusion_reason not null,
  reason_detail text,

  created_at    timestamptz            not null default now(),

  constraint ck_excluded_title check (btrim(title) <> ''),
  constraint ck_excluded_url   check (url is null or url ~ '^https?://')
);

create index ix_brief_excluded_brief  on public.brief_excluded_items (brief_id);
create index ix_brief_excluded_reason on public.brief_excluded_items (user_id, reason);


-- -----------------------------------------------------------------------------
-- 3.19 alerts — アラート履歴(P2)
--
--   dedup_key により同一事象の再送を防ぐ。「叱らず見せる」設計上、
--   同じことを何度も通知するのは最も避けたい失敗(設計原則3)。
-- -----------------------------------------------------------------------------
create table public.alerts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid                 not null references auth.users(id) on delete cascade,

  kind           alert_kind           not null,
  severity       alert_severity       not null default 'warn',
  status         alert_status         not null default 'pending',
  channel        notification_channel not null default 'discord',

  title          text                 not null,
  body           text,

  -- 関連レコード(どれか、または無し)
  transaction_id uuid                 references public.transactions(id) on delete cascade,
  debt_id        uuid                 references public.debts(id) on delete cascade,
  category_id    uuid                 references public.categories(id) on delete set null,
  job_run_id     uuid                 references public.job_runs(id) on delete set null,

  -- 再送防止キー(例:'waste_budget_70:2026-09')
  dedup_key      text                 not null,

  triggered_at   timestamptz          not null default now(),
  sent_at        timestamptz,
  acknowledged_at timestamptz,
  error_message  text,

  created_at     timestamptz          not null default now(),
  updated_at     timestamptz          not null default now(),

  constraint ck_alerts_title  check (btrim(title) <> ''),
  constraint ck_alerts_dedup  check (btrim(dedup_key) <> ''),
  constraint ck_alerts_sent   check ((status = 'sent') = (sent_at is not null)),
  constraint ck_alerts_failed check (status <> 'failed' or error_message is not null),
  constraint ck_alerts_ack    check ((status = 'acknowledged') = (acknowledged_at is not null))
);

-- 同じ事象を二度通知しない
create unique index ux_alerts_user_dedup on public.alerts (user_id, dedup_key);
create index ix_alerts_user_triggered    on public.alerts (user_id, triggered_at desc);
create index ix_alerts_pending           on public.alerts (user_id, triggered_at)
  where status = 'pending';
create index ix_alerts_transaction       on public.alerts (transaction_id)
  where transaction_id is not null;


-- -----------------------------------------------------------------------------
-- 3.20 app_checkins — 連続確認日数(FR-62)
--
--   途切れても責めない。ストリークは v_checkin_streak で算出する。
-- -----------------------------------------------------------------------------
create table public.app_checkins (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  checked_on  date        not null,
  source      text        not null default 'web',
  created_at  timestamptz not null default now(),

  primary key (user_id, checked_on)
);


-- =============================================================================
--  4. updated_at トリガの一括適用
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings','accounts','categories','budgets','debts','import_adapters',
    'transactions','classification_rules','debt_payments','repayment_scenarios',
    'transfer_rules','transfer_runs','transfer_run_items','side_projects',
    'side_work_logs','side_incomes','job_change_milestones',
    'investment_contributions','daily_briefs','alerts'
  ]
  loop
    execute format(
      'drop trigger if exists trg_%1$s_updated_at on public.%1$I;
       create trigger trg_%1$s_updated_at
         before update on public.%1$I
         for each row execute function public.set_updated_at();', t);
  end loop;
end;
$$;


-- =============================================================================
--  5. 完済シミュレーション(FR-02, FR-04)
--
--   利息計算は「毎月末に残高 × 年利 ÷ 12 を単利で加算し、返済は利息 → 元本の順に
--   充当する」モデル。日割り計算より粗いが、比較目的には十分で、本人が検算できる。
--   円未満は floor(切り捨て)で統一する。
-- =============================================================================

-- 単一債務の償還スケジュール
create or replace function public.simulate_debt_payoff(
  p_debt_id             uuid,
  p_monthly_payment_yen bigint,
  p_max_months          integer default 600
)
returns table (
  month_index         integer,
  due_on              date,
  opening_balance_yen bigint,
  interest_yen        bigint,
  principal_yen       bigint,
  payment_yen         bigint,
  closing_balance_yen bigint
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_balance  bigint;
  v_rate     numeric;
  v_day      smallint;
  v_interest bigint;
  v_payment  bigint;
  v_i        integer := 0;
begin
  select d.current_balance_yen, d.annual_rate, d.payment_day
    into v_balance, v_rate, v_day
  from public.debts d
  where d.id = p_debt_id;

  if v_balance is null then
    raise exception '債務 % が見つかりません', p_debt_id;
  end if;
  if p_monthly_payment_yen <= 0 then
    raise exception '月額返済額は正の値である必要があります(指定値: %)', p_monthly_payment_yen;
  end if;

  while v_balance > 0 and v_i < p_max_months loop
    v_i := v_i + 1;

    v_interest := floor(v_balance * v_rate / 12)::bigint;
    v_payment  := least(p_monthly_payment_yen, v_balance + v_interest);

    if v_payment <= v_interest then
      raise exception
        '月額 % 円では利息 % 円を下回るため完済できません(債務 %)',
        p_monthly_payment_yen, v_interest, p_debt_id;
    end if;

    month_index         := v_i;
    -- 支払日は 29〜31 日を月末差異で崩さないよう 28 日に丸める
    due_on              := public.month_start_jst(v_i) + (least(v_day, 28) - 1);
    opening_balance_yen := v_balance;
    interest_yen        := v_interest;
    payment_yen         := v_payment;
    principal_yen       := v_payment - v_interest;

    v_balance           := v_balance - principal_yen;
    closing_balance_yen := v_balance;

    return next;
  end loop;

  if v_balance > 0 then
    raise exception '% ヶ月以内に完済しません(残高 % 円)', p_max_months, v_balance;
  end if;
end;
$$;

comment on function public.simulate_debt_payoff(uuid, bigint, integer) is
  'FR-02:単一債務について、指定した月額返済額での償還スケジュールを返す。';


-- 全債務の合算シミュレーション(戦略込み)
create or replace function public.simulate_total_payoff(
  p_user_id            uuid,
  p_monthly_budget_yen bigint,
  p_strategy           repayment_strategy default 'avalanche',
  p_max_months         integer default 600
)
returns table (
  month_index          integer,
  month_on             date,
  opening_total_yen    bigint,
  interest_total_yen   bigint,
  principal_total_yen  bigint,
  payment_total_yen    bigint,
  closing_total_yen    bigint,
  debts_remaining      integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_bal      bigint[] := '{}';
  v_rate     numeric[] := '{}';
  v_min      bigint[]  := '{}';
  v_n        integer;
  v_i        integer := 0;
  k          integer;
  v_budget   bigint;
  v_interest bigint;
  v_pay      bigint;
  v_opening  bigint;
  v_closing  bigint;
  v_int_sum  bigint;
  v_pay_sum  bigint;
  r          record;
begin
  -- 戦略ごとの充当順に並べて配列へ読み込む。
  -- avalanche は金利降順、snowball は残高昇順。どちらも順序は期間中不変。
  for r in
    select d.current_balance_yen, d.annual_rate, d.minimum_payment_yen
    from public.debts d
    where d.user_id = p_user_id
      and d.status = 'active'
      and d.current_balance_yen > 0
    order by
      case when p_strategy = 'snowball' then d.current_balance_yen end asc nulls last,
      case when p_strategy <> 'snowball' then d.annual_rate end desc nulls last,
      d.id
  loop
    v_bal  := array_append(v_bal,  r.current_balance_yen);
    v_rate := array_append(v_rate, r.annual_rate);
    v_min  := array_append(v_min,  r.minimum_payment_yen);
  end loop;

  v_n := coalesce(array_length(v_bal, 1), 0);
  if v_n = 0 then
    return;
  end if;

  -- 'minimum' 戦略(FR-02 の比較対象)では月額予算を指定させず、各債務の最低返済額
  -- だけを充てる。債務が消えるほど月々の支払総額も減る、という実際の挙動を再現する。
  if p_strategy <> 'minimum'
     and (p_monthly_budget_yen is null or p_monthly_budget_yen <= 0) then
    raise exception '月額予算は正の値である必要があります(指定値: %)', p_monthly_budget_yen;
  end if;

  while v_i < p_max_months loop
    select coalesce(sum(b), 0) into v_opening from unnest(v_bal) as b;
    exit when v_opening <= 0;

    v_i := v_i + 1;
    v_int_sum := 0;
    v_pay_sum := 0;

    -- (1) 利息を計上して残高に加える
    for k in 1 .. v_n loop
      if v_bal[k] > 0 then
        v_interest := floor(v_bal[k] * v_rate[k] / 12)::bigint;
        v_bal[k]   := v_bal[k] + v_interest;
        v_int_sum  := v_int_sum + v_interest;
      end if;
    end loop;

    -- (2) 全債務へ最低返済額を充てる。
    --     予算は毎月ここでリセットする(前月の残りを持ち越さない)。
    if p_strategy = 'minimum' then
      -- 残っている債務の最低返済額の合計。完済した債務の分は自動的に外れる
      select coalesce(sum(v_min[i]), 0) into v_budget
      from generate_subscripts(v_bal, 1) as i
      where v_bal[i] > 0;
    else
      v_budget := p_monthly_budget_yen;
    end if;

    for k in 1 .. v_n loop
      exit when v_budget <= 0;
      if v_bal[k] > 0 then
        v_pay     := least(v_min[k], v_bal[k], v_budget);
        v_bal[k]  := v_bal[k] - v_pay;
        v_budget  := v_budget - v_pay;
        v_pay_sum := v_pay_sum + v_pay;
      end if;
    end loop;

    -- (3) 余剰を戦略順(配列順)に充てる。
    --     'minimum' は最低返済のみを再現する比較対象なので、余剰充当を行わない。
    if p_strategy <> 'minimum' then
      for k in 1 .. v_n loop
        exit when v_budget <= 0;
        if v_bal[k] > 0 then
          v_pay     := least(v_budget, v_bal[k]);
          v_bal[k]  := v_bal[k] - v_pay;
          v_budget  := v_budget - v_pay;
          v_pay_sum := v_pay_sum + v_pay;
        end if;
      end loop;
    end if;

    select coalesce(sum(b), 0) into v_closing from unnest(v_bal) as b;

    -- 残高が減らない月額は完済に到達しない。無限ループにせず明示的に落とす。
    if v_closing >= v_opening then
      raise exception
        '月額 % 円では残高が減りません(月初 % 円 → 月末 % 円)。利息 % 円を上回る返済が必要です。',
        coalesce(p_monthly_budget_yen, 0), v_opening, v_closing, v_int_sum;
    end if;

    month_index         := v_i;
    month_on            := public.month_start_jst(v_i);
    opening_total_yen   := v_opening;
    interest_total_yen  := v_int_sum;
    payment_total_yen   := v_pay_sum;
    principal_total_yen := v_pay_sum - v_int_sum;
    closing_total_yen   := v_closing;

    select count(*)::integer into debts_remaining from unnest(v_bal) as b where b > 0;

    return next;
  end loop;
end;
$$;

comment on function public.simulate_total_payoff(uuid, bigint, repayment_strategy, integer) is
  'FR-02/FR-04:全債務を合算し、戦略(アバランチ/スノーボール/最低返済のみ)に沿って配分した償還スケジュールを返す。';


-- =============================================================================
--  6. ビュー
--
--   security_invoker = true により、呼び出し元の権限で RLS が評価される。
-- =============================================================================

-- 負債の全体像。ホーム画面の完済カウントダウン(FR-03)の元データ
create view public.v_debt_overview
with (security_invoker = true) as
select
  d.user_id,
  count(*)::integer                                     as active_debt_count,
  sum(d.current_balance_yen)                            as total_balance_yen,
  sum(d.minimum_payment_yen)                            as total_minimum_payment_yen,
  -- 残高で加重した平均年利。単純平均は少額高金利の債務を過大評価する
  case when sum(d.current_balance_yen) > 0
       then round(sum(d.annual_rate * d.current_balance_yen)
                  / sum(d.current_balance_yen), 4)
  end                                                   as weighted_annual_rate,
  max(d.annual_rate)                                    as max_annual_rate,
  bool_or(d.is_estimated)                               as has_estimated_values,
  min(d.payment_day)                                    as next_payment_day
from public.debts d
where d.status = 'active'
group by d.user_id;

comment on view public.v_debt_overview is
  'has_estimated_values が true のあいだ、完済予定日を確定値として表示してはならない(ADR-006)。';


-- 当月のカテゴリ別支出。FR-14 / FR-20 の元データ
create view public.v_monthly_category_spend
with (security_invoker = true) as
select
  t.user_id,
  date_trunc('month', t.occurred_on)::date              as month,
  t.category_id,
  c.code                                                as category_code,
  c.name                                                as category_name,
  c.kind                                                as category_kind,
  -- 支出は負で入っているので、正の「使った額」に反転して返す
  sum(case when t.amount_yen < 0 then -t.amount_yen else 0 end) as spent_yen,
  sum(case when t.amount_yen > 0 then  t.amount_yen else 0 end) as received_yen,
  count(*)::integer                                     as transaction_count
from public.transactions t
left join public.categories c on c.id = t.category_id
where not t.is_transfer
  and t.review_status <> 'ignored'
group by t.user_id, date_trunc('month', t.occurred_on)::date,
         t.category_id, c.code, c.name, c.kind;


-- 当月の予算消化状況。FR-14「使える残額」/ FR-20 の 70% 判定
create view public.v_current_month_budget_status
with (security_invoker = true) as
with base as (
  select
    c.user_id,
    c.id                as category_id,
    c.code,
    c.name,
    c.kind,
    coalesce(b.amount_yen, c.default_monthly_budget_yen) as budget_yen,
    coalesce(b.carry_over_yen, 0)                        as carry_over_yen
  from public.categories c
  left join public.budgets b
    on  b.category_id = c.id
    and b.month = public.month_start_jst()
  where c.is_active
)
select
  base.user_id,
  base.category_id,
  base.code,
  base.name,
  base.kind,
  base.budget_yen,
  base.carry_over_yen,
  coalesce(s.spent_yen, 0)                               as spent_yen,
  case when base.budget_yen is not null
       then base.budget_yen + base.carry_over_yen - coalesce(s.spent_yen, 0)
  end                                                    as remaining_yen,
  case when coalesce(base.budget_yen, 0) > 0
       then round(coalesce(s.spent_yen, 0)::numeric / base.budget_yen, 3)
  end                                                    as usage_ratio
from base
left join public.v_monthly_category_spend s
  on  s.user_id     = base.user_id
  and s.category_id = base.category_id
  and s.month       = public.month_start_jst();

comment on view public.v_current_month_budget_status is
  'FR-14:remaining_yen を「あと〇円使える」と肯定形で表示する。FR-20:usage_ratio >= 0.7 でアラート。';


-- 連続確認日数(FR-62)。途切れても責めず、再開だけを提示するための素材
create view public.v_checkin_streak
with (security_invoker = true) as
with islands as (
  select
    user_id,
    checked_on,
    checked_on - (row_number() over (partition by user_id order by checked_on))::integer
      as island_key
  from public.app_checkins
),
grouped as (
  select user_id, island_key, count(*)::integer as length, max(checked_on) as last_day
  from islands
  group by user_id, island_key
)
select
  user_id,
  coalesce(max(length) filter (where last_day >= public.today_jst() - 1), 0)
                                       as current_streak_days,
  max(length)                          as longest_streak_days,
  max(last_day)                        as last_checkin_on
from grouped
group by user_id;


-- =============================================================================
--  7. Row Level Security(ADR-011)
--
--   シングルユーザーだが全テーブルに張る。anon キーが露出しても他人のデータへ
--   到達できない状態を既定にする(NFR-04)。
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings','accounts','categories','budgets','debts','import_adapters',
    'import_batches','transactions','classification_rules','debt_payments',
    'repayment_scenarios','transfer_rules','transfer_runs','transfer_run_items',
    'side_projects','side_work_logs','side_incomes','job_change_milestones',
    'investment_contributions','investment_snapshots','job_runs','daily_briefs',
    'brief_items','brief_excluded_items','alerts','app_checkins'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
    execute format($p$
      drop policy if exists "own_rows" on public.%1$I;
      create policy "own_rows" on public.%1$I
        for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()));
    $p$, t);
  end loop;
end;
$$;


-- =============================================================================
--  8. 初期データ投入
--
--   auth.users にユーザーが作られた後、一度だけ呼ぶ。
--     select public.seed_defaults(auth.uid());
-- =============================================================================

create or replace function public.seed_defaults(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cat_sanctuary uuid;
  v_cat_living    uuid;
begin
  -- 設定(ADR-003〜005 の初期値は列 DEFAULT に持たせてある)
  insert into public.app_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- カテゴリ(FR-11 の初期値)。
  --
  -- name はあくまで初期値であり、本人がいつでも変更できる(FR-13, ADR-016)。
  -- 変えても壊れないのは、コードとルールが参照するのが code と kind だけだからである。
  -- 予算額もここに置く。app_settings 側には持たない(二重定義を避ける)。
  -- show_on_home はホーム最上部に残額を出す枠。これも本人が選び直せる(FR-61)。
  insert into public.categories
    (user_id, code, name, kind, default_monthly_budget_yen, sort_order, is_system, show_on_home)
  values
    (p_user_id, 'fixed_cost',          '固定費',       'fixed_cost',          100000, 10, true, false),
    (p_user_id, 'living',              '生活費',       'living',               60000, 20, true, true),
    (p_user_id, 'sanctuary',           '聖域',         'sanctuary',            40000, 30, true, true),
    (p_user_id, 'waste',               '浪費',         'waste',                20000, 40, true, false),
    (p_user_id, 'investment_spending', '投資的支出',   'investment_spending',  10000, 50, true, false),
    (p_user_id, 'repayment',           '返済',         'repayment',              null, 60, true, false),
    (p_user_id, 'investment',          '投資',         'investment',             null, 70, true, false),
    (p_user_id, 'income',              '収入',         'income',                 null, 80, true, false),
    (p_user_id, 'transfer',            '口座間振替',   'transfer',               null, 90, true, false)
  on conflict (user_id, code) do nothing;

  select id into v_cat_sanctuary from public.categories
    where user_id = p_user_id and code = 'sanctuary';
  select id into v_cat_living from public.categories
    where user_id = p_user_id and code = 'living';

  -- FR-21:リボ・キャッシング・分割の検知ルール。
  -- AI ではなく決定的な正規表現で判定する(ADR-010)。見逃しが致命的なため
  -- priority を最上位に置き、他のどのルールより先に評価させる。
  insert into public.classification_rules
    (user_id, name, priority, match_type, pattern, set_payment_method, is_active)
  values
    (p_user_id, 'リボ払いの検知',       1, 'regex',
     '(リボ|ﾘﾎﾞ|revolving|リボルビング)',            'revolving',   true),
    (p_user_id, 'キャッシングの検知',   2, 'regex',
     '(キャッシング|ｷｬｯｼﾝｸﾞ|CASHING|カードローン|ATM借入)', 'cashing',     true),
    (p_user_id, '分割払いの検知',       3, 'regex',
     '(分割|[0-9]+回払|ボーナス払)',                  'installment', true)
  on conflict (user_id, name) do nothing;

  -- FR-15:給料日振替の既定順序(返済 → 投資 → 女遊び → 生活費)。
  -- 金額は本人が設定画面で調整する前提の初期値。
  insert into public.transfer_rules
    (user_id, name, trigger, execution_order, amount_type, amount_yen, category_id)
  values
    (p_user_id, '返済へ',       'payday', 1, 'fixed',     100000, null),
    (p_user_id, '投資へ',       'payday', 2, 'fixed',      20000, null),
    (p_user_id, '聖域枠へ',     'payday', 3, 'fixed',      40000, v_cat_sanctuary),
    (p_user_id, '生活費へ',     'payday', 4, 'remainder',   null, v_cat_living)
  on conflict (user_id, name) do nothing;

  -- FR-02:比較の基準となる「最低返済のみ」シナリオ
  insert into public.repayment_scenarios
    (user_id, name, strategy, monthly_budget_yen, is_baseline, sort_order)
  values
    (p_user_id, '最低返済のみ', 'minimum',   null,   true,  10),
    (p_user_id, '月10万円返済', 'avalanche', 100000, false, 20)
  on conflict (user_id, name) do nothing;
end;
$$;

comment on function public.seed_defaults(uuid) is
  'カテゴリ・検知ルール・振替ルール・比較シナリオの初期値を投入する。ユーザー作成直後に一度だけ実行する。';


-- =============================================================================
--  9. 定期ジョブ(pg_cron)
--
--   ADR-009:外部 API を呼ぶ業務ジョブは GitHub Actions に置く。
--   ここに置くのは「DB 自身が自分を生かす」死活経路のみ(NFR-05)。
--   GitHub Actions 側が止まっても、この1本だけは動き続ける。
-- =============================================================================

-- 毎日 03:15 JST(= 18:15 UTC)に軽量な書き込みを行い、無料枠の自動停止を回避する
select cron.schedule(
  'keepalive-touch',
  '15 18 * * *',
  $cron$
    insert into public.job_runs (user_id, job_name, status, trigger_source,
                                 finished_at, duration_ms, items_processed)
    select u.id, 'keepalive', 'succeeded', 'pg_cron', now(), 0, 1
    from auth.users u;

    delete from public.job_runs
    where job_name = 'keepalive'
      and started_at < now() - interval '90 days';
  $cron$
);

commit;


-- =============================================================================
--  付録:仕様書 7章のエンティティとの対応
--
--   accounts                → accounts
--   debts                   → debts
--   debt_payments           → debt_payments
--   transactions            → transactions(+ import_batches, import_adapters)
--   categories              → categories
--   classification_rules    → classification_rules
--   transfer_rules          → transfer_rules(+ transfer_runs, transfer_run_items)
--   budgets                 → budgets
--   side_income_logs        → side_projects, side_work_logs, side_incomes に分割
--                             (時給換算 FR-40 のため作業時間と入金を分離)
--   job_change_milestones   → job_change_milestones
--   investments             → investment_contributions, investment_snapshots に分割
--                             (拠出フローと時価ストックは別物のため)
--   daily_briefs            → daily_briefs(+ brief_items, brief_excluded_items)
--   alerts                  → alerts
--   job_runs                → job_runs
--
--   追加したテーブル
--   app_settings            → ADR-014(業務パラメータの外出し)
--   repayment_scenarios     → FR-02/FR-04 の比較条件の保存
--   import_adapters         → ADR-007(CSV フォーマット差異の吸収)
--   import_batches          → FR-10 の冪等な取り込み
--   app_checkins            → FR-62 のストリーク算出
-- =============================================================================
