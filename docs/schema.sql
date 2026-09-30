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
  'rule',    -- ADR-057でパターンルール(classification_rules)は廃止した。
             -- 値そのものは既存データ・DBの enum 定義として残すが、
             -- 現在このアプリが新規に書き込むことはない。
  'ai',      -- Claude によるジャンル分類(/reports/genres)
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

-- 目標(AI相談で決めた目標、本人発案)
create type goal_status as enum ('active', 'achieved', 'abandoned');

-- 明細ごとの浪費/必要経費診断(本人発案、ADR-030)
create type spending_verdict as enum ('waste', 'necessary');

-- 固定6分類のみ。AIに自由記述させない(ADR-031)。「一般的にこういうタイプ」
-- という要望に応えつつ、根拠の無い性格診断・医学的な断定に踏み込ませない歯止め。
create type spending_persona_type as enum (
  'impulsive',
  'steady',
  'social',
  'goal_oriented',
  'frugal',
  'balanced'
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

  -- ジャンル別の月次予算はここに置かない。genres.budget_yen が正
  -- (ADR-016/ADR-057)。設定側にも金額を持つと二重定義になり、
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
  classification_model                text         not null default 'claude-haiku-4-5',

  -- AIゲートウェイ(N1)。全AI機能の一括オフ。オフでも基本機能はすべて使える。
  -- gmail_enabled と同じ、設定は残したまま条件だけ切り替える方式。
  ai_enabled                           boolean      not null default true,

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

  -- Google連携(本人発案)。月次バックアップ(Googleスプレッドシート)の
  -- 書き込み先。初回のバックアップ時にアプリが自動でスプレッドシートを
  -- 作成し、その id をここへ記録する(以降は同じシートへ書き続ける)。
  -- 値そのものは秘密情報ではない(参照名、ADR-014)。実際の認証情報
  -- (GOOGLE_REFRESH_TOKEN 等)は環境変数のみに置く。
  google_backup_spreadsheet_id        text,

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


-- categories・budgets は ADR-057 で廃止した(本人発案、生活費・浪費などの
-- 主観的なカテゴリ分けの廃止)。旧 categories の役割(名前・予算・ホーム表示枠)
-- は genres(このすぐ下)が引き継ぎ、budgets(コードのどこからも書き込みが
-- 無い死んだ仕組みだった)は genres.budget_yen という単一の値に統合した。
-- 旧定義は supabase/migrations/20260929000100_retire_categories.sql が
-- 本番のテーブルを退役させる形で反映する。
--
-- 3.3 genres — 支出の唯一の分類(本人発案、ADR-056/ADR-057)
-- -----------------------------------------------------------------------------
-- 当初は固定enum(spending_genre)として設計し、本人からの「dbに保存して
-- enumじゃなくて、自由に変更できる仕組みに」という指摘でDBテーブルへ変更した
-- (ADR-056)。さらにADR-057で「生活費・浪費などの主観的なカテゴリ分けを
-- 完全に廃止し、ジャンルを唯一のカテゴリにする」という決定により、旧
-- categories の役割(予算設定・ホーム表示枠)を丸ごと引き継いだ。kind・
-- is_system・統合(merged_into_id)は引き継がない——ジャンルは本人が自由に
-- 追加・削除できる対象で、削除は統合を経由せず即座に行える(参照側の
-- genre_id を on delete set null/cascade にする)。
--
-- transactions・transfer_rules・transaction_splits・receipt_items・alerts が
-- genre_id で直接参照するため、それらより前に定義する必要がある(当初は
-- 旧セクション番号 3.30 に置いていたが、参照元より後ろにあると `create table`
-- の順序でエラーになるため、旧 categories と同じこの位置へ移した)。
create table public.genres (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  sort_order   integer     not null default 0,

  -- 月次予算(本人発案「カテゴリのそれぞれの値段設定」)。未設定なら無制限。
  budget_yen   bigint,

  -- ホーム画面に残額を出すジャンルか(旧 categories.show_on_home、FR-14, FR-61)。
  show_on_home boolean     not null default false,

  -- 見た目(利用者が選ぶ。null は名前からの既定。domain/genre-style.ts)
  icon_key     text,
  color_index  smallint,

  created_at   timestamptz not null default now(),

  constraint ck_genres_color_index check (color_index is null or color_index between 1 and 10),
  constraint ck_genres_name_not_blank check (btrim(name) <> ''),
  constraint ck_genres_budget check (budget_yen is null or budget_yen >= 0)
);

create unique index ux_genres_user_name on public.genres (user_id, name);
create index ix_genres_user on public.genres (user_id, sort_order);
create index ix_genres_show_on_home on public.genres (user_id, sort_order)
  where show_on_home;


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

  -- レシート撮影(source='manual')でだけ使う。Storage の receipts バケットの
  -- オブジェクトキー({user_id}/{uuid}.拡張子)。1回の撮影=1バッチのため
  -- ここに置く(1枚の写真に複数の買い物が写っていても同じ画像を指す。
  -- transactions 側に複製しない)。CSV・メールの取り込みでは常に null
  -- (本人発案、ADR-021 の続き)。
  receipt_image_path text,

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

  -- 分類(ADR-057:唯一のカテゴリである genres への分類)
  genre_id          uuid               references public.genres(id) on delete set null,
  classified_by     classified_by      not null default 'unclassified',
  confidence        numeric(4,3),
  review_status     review_status      not null default 'pending',
  reviewed_at       timestamptz,

  -- FR-21 の判定対象。AI ではなく決定的なルールで埋める(ADR-010)
  payment_method    payment_method     not null default 'unknown',

  -- 口座間振替は収支に計上しない
  is_transfer       boolean            not null default false,
  counter_transaction_id uuid          references public.transactions(id) on delete set null,

  -- 本人発案「絶対払わざるを得ないもの」に明細1件ごとに付けるラベル
  -- (ジャンルとは独立した軸。ADR-057)。裁量的な支出と分けてグラフ表示する。
  must_pay          boolean            not null default false,

  -- 実績/予定(今日より未来は予定として実績の集計から外す)と、通常/特別費
  -- (特別費は目標のペース計算から除く)。返品・返金('refund')は金額が正で、そのジャンルの
  -- 支出から差し引く。domain/ledger.ts 参照。
  status            text               not null default 'actual',
  kind              text               not null default 'normal',

  -- 店名を正規化して分けた支店名(merchant_name は店名のみ)と、レシートの照合で
  -- 解消していない差額(0/null なら一致)。要確認カードの「金額不一致」に使う。
  branch_name        text,
  reconcile_diff_yen integer,

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
  -- 分類済みならジャンルがある
  constraint ck_transactions_classified_has_genre
    check (classified_by = 'unclassified' or genre_id is not null),
  -- 本人が確認・修正したなら日時が残る(学習データの根拠)
  constraint ck_transactions_reviewed_at
    check (review_status not in ('confirmed','corrected') or reviewed_at is not null),
  constraint ck_transactions_not_self_counter
    check (counter_transaction_id is null or counter_transaction_id <> id),
  constraint ck_transactions_posted_after_occurred
    check (posted_on is null or posted_on >= occurred_on),
  constraint ck_transactions_status check (status in ('actual', 'scheduled')),
  constraint ck_transactions_kind   check (kind in ('normal', 'special', 'refund'))
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
create index ix_transactions_user_genre_occurred
  on public.transactions (user_id, genre_id, occurred_on desc);
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
  '「ジャンルを誰が決めたか」を表す。支払方法だけを設定するルール(リボ検知など)は
   ジャンルを付けないため、この列を変更しない。unclassified 以外はジャンル必須。';
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


-- classification_rules(パターンによるカテゴリの自動判定、FR-12/FR-13)は
-- ADR-057で廃止した。本人が「このパターンはこのカテゴリ」と決めるパターン
-- ルールも、結局は生活費・浪費のカテゴリ分けと同じ主観であるため。
-- リボ払い等の危険検知(FR-21)はこのテーブルとは独立に、TS側の
-- `DEFAULT_DETECTION_RULES`(features/classification/rules.ts)として
-- 最初からDBに保存されない形で持っていたため、この廃止の影響を受けない。


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
  genre_id         uuid                 references public.genres(id) on delete set null,

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
  genre_id       uuid                 references public.genres(id) on delete set null,
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


-- -----------------------------------------------------------------------------
-- 3.21 rescued_emails — AI救済メールの保存(T-11)
--
--   ラベル辞書(email.ts の LABELS)で読めず AI に回ったメールの本文を残す。
--   辞書に語を足せば同じ書式は次から費用ゼロの経路に戻せるが、それには
--   「どんな書式で落ちたか」を後から見返せる必要がある(ADR-019)。
-- -----------------------------------------------------------------------------
create table public.rescued_emails (
  id              uuid               primary key default gen_random_uuid(),
  user_id         uuid               not null references auth.users(id) on delete cascade,

  source          transaction_source not null,  -- 'gmail' か 'manual'(メール貼り付け)
  subject         text,
  body            text               not null,
  extracted_count smallint           not null default 0,  -- AI が読み取れた明細数。0ならAIも失敗

  created_at      timestamptz        not null default now(),

  constraint ck_rescued_emails_extracted_count check (extracted_count >= 0)
);

create index ix_rescued_emails_user_created on public.rescued_emails (user_id, created_at desc);


-- -----------------------------------------------------------------------------
-- 3.22 net_worth_snapshots — 資産推移の月次記録(P6-3)
--
--   debts.current_balance_yen は現在値のみで履歴を持たない。資産推移グラフ
--   (残債総額 + 投資評価額の時系列)を出すには、月末に両者の合計を1行として
--   記録し始める必要がある。投資評価額は investment_snapshots(商品ごとの
--   時点スナップショット)から、記録時点で商品ごとに最新の値を合算したもの。
-- -----------------------------------------------------------------------------
create table public.net_worth_snapshots (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users(id) on delete cascade,

  as_of                date        not null,
  debt_balance_yen     bigint      not null,
  investment_value_yen bigint      not null,

  created_at           timestamptz not null default now(),

  constraint ck_net_worth_debt_balance check (debt_balance_yen >= 0),
  constraint ck_net_worth_investment_value check (investment_value_yen >= 0)
);

create unique index ux_net_worth_snapshots_user_as_of
  on public.net_worth_snapshots (user_id, as_of);
create index ix_net_worth_snapshots_user_as_of_desc
  on public.net_worth_snapshots (user_id, as_of desc);


-- -----------------------------------------------------------------------------
-- 3.23 transaction_splits — 明細の複数ジャンル分割
--
--   1件の明細を複数のジャンルに配分できるようにする。transactions.genre_id
--   はそのまま残し、分割がある明細だけこの表の行の合計で amount_yen を
--   置き換える(合計が一致することの保証はアプリ側、domain/transaction-splits.ts
--   の assertValidSplits() が正。複数行にまたがる合計チェックは CHECK 制約
--   では表現できない)。
-- -----------------------------------------------------------------------------
create table public.transaction_splits (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  transaction_id uuid        not null references public.transactions(id) on delete cascade,
  genre_id       uuid        references public.genres(id) on delete set null,

  amount_yen     bigint      not null,
  note           text,

  created_at     timestamptz not null default now(),

  constraint ck_transaction_splits_amount_nonzero check (amount_yen <> 0)
);

create index ix_transaction_splits_transaction on public.transaction_splits (transaction_id);
create index ix_transaction_splits_user on public.transaction_splits (user_id);


-- 3.24 goals — AI相談(目標設定・買う前相談)で決めた目標(本人発案)
--
--   「◯月までに◯万円貯める」のような目標を、対話の結果として保存する。
--   進捗(current_amount_yen)は自動計算せず本人が更新する(口座連携が無く、
--   収支全体からの推定では「この目標のために」貯めた額と一致しない可能性が
--   あるため。TASKS.md 参照)。target_amount_yen/target_date は無くても
--   目標として成立する(「浪費を減らす」のような金額・期限を持たない目標もある)。
-- -----------------------------------------------------------------------------
create table public.goals (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,

  title              text        not null,
  target_amount_yen  bigint,
  target_date        date,
  current_amount_yen bigint      not null default 0,

  status             goal_status not null default 'active',
  note               text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  achieved_at        timestamptz,

  constraint ck_goals_title_not_blank check (btrim(title) <> ''),
  constraint ck_goals_target_amount   check (target_amount_yen is null or target_amount_yen > 0),
  constraint ck_goals_current_amount  check (current_amount_yen >= 0),
  constraint ck_goals_achieved        check ((status = 'achieved') = (achieved_at is not null))
);

create index ix_goals_user_status on public.goals (user_id, status, created_at desc);

create trigger trg_goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();


-- 3.25 transaction_diagnoses — 明細ごとの浪費/必要経費診断(本人発案、ADR-030)
--
--   category_kind(浪費/生活費/聖域...)はカテゴリ単位の静的な分類で、同じ
--   カテゴリでも1件ごとの事情までは表さない(例:「外食」でも仕事の会食と
--   気晴らしの外食では意味が違う)。ここでは明細1件ごとに投資家目線でAIが
--   下した動的な評定を保存する。1明細につき1行(再診断は upsert で上書き、
--   過去の評定を履歴として重ねて残す機能ではない)。月ごとの浪費傾向の推移は
--   この表と transactions.occurred_on を突き合わせて都度集計する
--   (features/diagnosis/store.ts、新しいスナップショットテーブルは持たない)。
-- -----------------------------------------------------------------------------
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

-- 3.26 ai_monthly_reports — AI月次レポート(本人発案「AI関連もっと増やしたい。
-- もっと画期的な機能ない?」、ADR-031)
--
--   家計簿・診断(transaction_diagnoses)の蓄積データを1ヶ月分まとめて
--   AIに渡し、①浪費傾向のタイプ(固定6分類、persona_type)、②実データに
--   基づく気づき、③行動面の一般的なアドバイスを生成する。1ヶ月につき1行
--   (再生成は upsert で上書き、過去のレポートを履歴として重ねて残す機能
--   ではない——transaction_diagnoses と同じ考え方)。医学的な性格診断や
--   ホルモン等の身体的な断定はさせない(ADR-031、本人の明示的な要望で除外)。
-- -----------------------------------------------------------------------------
create table public.ai_monthly_reports (
  id                uuid                  primary key default gen_random_uuid(),
  user_id           uuid                  not null references auth.users(id) on delete cascade,
  month             date                  not null,

  persona_type      spending_persona_type not null,
  -- なぜそのタイプと判断したか。ラベルだけでなく理由が見えることで、
  -- 本人が納得したり反論したりできる(transaction_diagnoses.reasoning と同じ考え方)。
  persona_reasoning text                  not null,
  -- 実データに基づく気づき(複数件)。数値を独自に作らせず、渡した実際の
  -- 集計値だけを根拠にさせる(features/ai-report/monthly-report-ai.ts 参照)。
  insights          text[]                not null default '{}',
  -- 行動面の一般的なアドバイス(複数件)。食事・体質等、金融データから
  -- 導けない領域には踏み込ませない。
  advice            text[]                not null default '{}',

  created_at        timestamptz           not null default now(),

  constraint ck_ai_monthly_reports_month_is_first_day check (extract(day from month) = 1),
  constraint ck_ai_monthly_reports_persona_reasoning_not_blank check (btrim(persona_reasoning) <> ''),
  constraint ck_ai_monthly_reports_insights_not_empty check (array_length(insights, 1) > 0),
  constraint ck_ai_monthly_reports_advice_not_empty check (array_length(advice, 1) > 0)
);

create unique index ux_ai_monthly_reports_user_month on public.ai_monthly_reports (user_id, month);

-- 3.27 ai_daily_reports — AI日次レポート(本人発案「日次レポートと月次
-- レポートどっちも出力できるように」、ADR-032)
--
--   今日1日分の実データ(支出・カテゴリ・診断結果)をAIに渡し、気づきと
--   アドバイスを生成する。ai_monthly_reports と異なり persona_type を持たない
--   ——1日分のデータでは浪費傾向のタイプ判定にノイズが大きすぎるため、
--   タイプ判定は月次レポートに一本化する(ADR-032)。1日につき1行(再生成は
--   upsert で上書き、過去のレポートを履歴として重ねて残す機能ではない)。
-- -----------------------------------------------------------------------------
create table public.ai_daily_reports (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  report_date date        not null,

  insights    text[]      not null default '{}',
  advice      text[]      not null default '{}',

  created_at  timestamptz not null default now(),

  constraint ck_ai_daily_reports_insights_not_empty check (array_length(insights, 1) > 0),
  constraint ck_ai_daily_reports_advice_not_empty check (array_length(advice, 1) > 0)
);

create unique index ux_ai_daily_reports_user_date on public.ai_daily_reports (user_id, report_date);

-- 3.28 receipt_items — レシートの品目(本人発案、ADR-034)
--
--   「レシートというのは店と品目を全て合わせた概念」という指摘への対応。
--   transaction_splits(カテゴリ分割、2件以上・合計一致が必須)とは別物——
--   こちらは「何を買ったか」を常に残す記録で、1点だけの買い物でも、内訳の
--   合計が支払額と一致しなくても保存する。カテゴリ分割の対象になるかどうかに
--   関わらず、レシートに商品行が写っていた明細には必ず付く。
-- -----------------------------------------------------------------------------
create table public.receipt_items (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  transaction_id uuid        not null references public.transactions(id) on delete cascade,

  name           text        not null,
  amount_yen     bigint      not null,
  sort_order     smallint    not null default 0,
  -- ジャンル分割(transaction_splits)の対象かどうかに関わらず品目単体にも
  -- 付けられる。null は分類できなかった・分類前(ADR-035)
  genre_id       uuid        references public.genres(id) on delete set null,
  -- 固定カテゴリとは別の、商品の種類そのもののAI自由記述(ADR-036)。
  -- 例:飲料・調味料・菓子。固定語彙を与えないため enum ではなく text
  product_type   text,

  created_at     timestamptz not null default now(),

  constraint ck_receipt_items_name_not_blank check (btrim(name) <> ''),
  constraint ck_receipt_items_amount_nonzero check (amount_yen <> 0)
);

create index ix_receipt_items_transaction on public.receipt_items (transaction_id, sort_order);
create index ix_receipt_items_user on public.receipt_items (user_id);


-- -----------------------------------------------------------------------------
-- 3.29 transaction_expense_subtypes — 生活費の小分類(本人発案、ADR-036)
--
--   「生活費」カテゴリの明細が具体的に何系の生活費か(食費・日用品・外食
--   など)をAIの自由記述で持たせる。receipt_items・transaction_splits と
--   同じく、この値は今のところレシート取り込みという1つの経路からしか
--   生まれない(通常の CSV・メール取り込みでは値が無い)ため、transactions
--   本体に列を足すのではなく別テーブルにした。1明細につき最大1行。
-- -----------------------------------------------------------------------------
create table public.transaction_expense_subtypes (
  transaction_id uuid        primary key references public.transactions(id) on delete cascade,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  subtype        text        not null,
  created_at     timestamptz not null default now(),

  constraint ck_transaction_expense_subtypes_not_blank check (btrim(subtype) <> '')
);

create index ix_transaction_expense_subtypes_user on public.transaction_expense_subtypes (user_id);
-- 3.31 spending_plans / spending_plan_items — 期間つきの支出目標(本人発案、ADR-058)
--
--   カレンダーで選んだ期間(period_start〜period_end)について、ジャンルごとの
--   支出目標を持つ。AIが過去の支出と課題(予算超過・増加傾向・浪費判定・
--   必須ラベル)から目安を提案し(ai_suggested_yen、reason)、本人が
--   target_yen へ直す。step_percent は提案時の「改善の強さ」で、1回の
--   目標で削る幅の上限(徐々に改善するための歯止め)。ジャンルの恒常的な
--   月次予算(genres.budget_yen)とは別物で、期間ごとに立て直していく。
-- -----------------------------------------------------------------------------
create table public.spending_plans (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  period_start date        not null,
  period_end   date        not null,
  step_percent integer     not null default 10,
  created_at   timestamptz not null default now(),

  constraint ck_spending_plans_period check (period_end >= period_start),
  constraint ck_spending_plans_step   check (step_percent between 0 and 50)
);

create index ix_spending_plans_user on public.spending_plans (user_id, created_at desc);

create table public.spending_plan_items (
  id               uuid   primary key default gen_random_uuid(),
  plan_id          uuid   not null references public.spending_plans(id) on delete cascade,
  user_id          uuid   not null references auth.users(id) on delete cascade,
  genre_id         uuid   not null references public.genres(id) on delete cascade,
  target_yen       bigint not null,
  ai_suggested_yen bigint,
  reason           text,

  constraint ck_spending_plan_items_target check (target_yen >= 0),
  constraint ck_spending_plan_items_ai     check (ai_suggested_yen is null or ai_suggested_yen >= 0)
);

create unique index ux_spending_plan_items_plan_genre
  on public.spending_plan_items (plan_id, genre_id);
create index ix_spending_plan_items_user on public.spending_plan_items (user_id);

-- 3.32 genre_memory — 分類パイプラインの記憶(個人の履歴・利用者のルール)
--   分類は 利用者のルール → 個人の履歴(店×品目)→ 品目辞書 → AI の順に当てる。
--   前半 2 段の元データがここ。store_key='' は「どの店でも」。pinned=true が
--   利用者のルール。利用者が直した内容は即座にここへ反映する。
-- -----------------------------------------------------------------------------
create table public.genre_memory (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  store_key  text        not null default '',
  item_key   text        not null,
  genre_id   uuid        not null references public.genres(id) on delete cascade,
  pinned     boolean     not null default false,
  hits       integer     not null default 1,
  updated_at timestamptz not null default now(),

  constraint ck_genre_memory_item_not_blank check (btrim(item_key) <> ''),
  constraint ck_genre_memory_hits check (hits >= 1)
);

create unique index ux_genre_memory_key
  on public.genre_memory (user_id, store_key, item_key);
create index ix_genre_memory_user on public.genre_memory (user_id);

-- -----------------------------------------------------------------------------
-- 3.33 receipt_captures — 読み取りに失敗したレシートの「入力待ち」(F7)
--   撮影した画像とAIの生の読み取り結果を残し、手で入力して明細にするまでの記録。
--   transactions とは別に持つので、入力が終わるまで集計・目標には入らない。
--   元の画像は破棄しても消さない(status='discarded' にするだけ。Undo できる)。
-- -----------------------------------------------------------------------------
create table public.receipt_captures (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,

  -- needs_input: 手で入力する必要がある(明細・要確認に「入力待ち」と出る)
  -- resolved   : 明細として保存済み(transaction_id が入る)
  -- discarded  : 破棄した(Undo できるよう行は消さず、画像も残す)
  status            text        not null default 'needs_input',
  -- 読み取りの結果: parsed(全部読めた)/ partial(一部だけ)/ failed(読めない)/ manual(最初から手入力)
  receipt_status    text        not null default 'failed',

  -- 元の画像は消さない。補正(切り抜き・回転・明るさ)した画像は別のパスで持つ。
  image_path        text        not null,
  edited_image_path text,

  -- AI の生の読み取り結果(warnings・部分的に読めた値)。再読み取りの比較に使う。
  ocr_raw           jsonb,
  -- 読み取れた項目({amountYen, occurredOn, storeName, ...})と読めなかった項目の名前。
  read_fields       jsonb       not null default '{}'::jsonb,
  unread_fields     text[]      not null default '{}',
  -- 入力途中の内容(下書き)。離れても消えない。
  draft             jsonb,
  draft_updated_at  timestamptz,

  transaction_id    uuid        references public.transactions(id) on delete set null,
  captured_on       date        not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  discarded_at      timestamptz,

  constraint ck_receipt_captures_status
    check (status in ('needs_input', 'resolved', 'discarded')),
  constraint ck_receipt_captures_receipt_status
    check (receipt_status in ('parsed', 'partial', 'failed', 'manual'))
);

create index ix_receipt_captures_user_status
  on public.receipt_captures (user_id, status, created_at desc);


-- AIゲートウェイ(N1):同一入力に対するAI応答のキャッシュ。キーは呼び出し側が
-- 「機能名+入力の決定的な文字列」から作るハッシュ(src/lib/ai-gateway/cache.ts)。
create table public.ai_cache (
  cache_key      text        primary key,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  feature        text        not null,
  response_json  jsonb       not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create index ai_cache_user_id_idx on public.ai_cache (user_id);
create index ai_cache_expires_at_idx on public.ai_cache (expires_at);




-- =============================================================================
--  4. updated_at トリガの一括適用
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings','accounts','debts','import_adapters',
    'transactions','debt_payments','repayment_scenarios',
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


-- v_monthly_category_spend・v_current_month_budget_status(カテゴリ別支出・
-- 予算消化状況)は、どちらもアプリのどこからも実際に問い合わせていない
-- ドキュメント用のビューだった(実装は domain/budget.ts に相当ロジックを
-- 持つ)。ADR-057 でカテゴリ(categories)を廃止したのに伴い、書き直すより
-- 削除する方が実態に合う(使われていないSQLを保守し続けない、ADR-033)。


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
    'app_settings','accounts','debts','import_adapters',
    'import_batches','transactions','debt_payments',
    'repayment_scenarios','transfer_rules','transfer_runs','transfer_run_items',
    'side_projects','side_work_logs','side_incomes','job_change_milestones',
    'investment_contributions','investment_snapshots','job_runs','daily_briefs',
    'brief_items','brief_excluded_items','alerts','app_checkins','rescued_emails',
    'net_worth_snapshots','transaction_splits','goals','transaction_diagnoses',
    'ai_monthly_reports','ai_daily_reports','receipt_items',
    'transaction_expense_subtypes','genres','spending_plans','spending_plan_items',
    'genre_memory','receipt_captures','ai_cache'
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


-- -----------------------------------------------------------------------------
-- 7.1 Supabase Storage — レシート画像(本人発案、ADR-021 の続き)
--
--   receipts バケット自体は SQL の対象外(Storage REST API で作る。バケットの
--   列構成はプラットフォームのバージョンで変わりうるため、SQL の insert では
--   触らない)。ここで固定するのはオブジェクトへのアクセス制御だけ。
--
--   パスは "{user_id}/{uuid}.拡張子" にすることを前提に、本人のフォルダだけ
--   読み書きできるようにする(Supabase 公式のフォルダ単位アクセス制御と同じ
--   パターン)。アップロードは features/import/receipt-storage.ts が本人の
--   セッション(RLS 適用)で行うため、ここが実際の砦になる。
--
--   storage.objects は Supabase 側で作成時から RLS が有効になっている
--   (テーブルの所有者は supabase_storage_admin で、SQL Editor が使う
--   postgres ロールはその所有権を持たない)。ALTER TABLE ... ENABLE ROW
--   LEVEL SECURITY を実行すると「must be owner of table objects」で失敗
--   するため、ここでは有効化し直さず、ポリシーの作成だけ行う
--   (実際に本番プロジェクトで確認)。
-- -----------------------------------------------------------------------------

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
begin
  -- 設定(ADR-003〜005 の初期値は列 DEFAULT に持たせてある)
  insert into public.app_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- ジャンル(ADR-057)。本人がいつでも自由に追加・削除できる一覧で、
  -- ここでの初期値は最初の目安に過ぎない(features/genre/store.ts の
  -- DEFAULT_GENRE_NAMES と同じ一覧)。
  insert into public.genres (user_id, name, sort_order)
  values
    (p_user_id, '食料品', 10), (p_user_id, '外食', 20),
    (p_user_id, 'カフェ・飲料', 30), (p_user_id, '酒', 40),
    (p_user_id, '日用品', 50), (p_user_id, '衣服・ファッション', 60),
    (p_user_id, '美容', 70), (p_user_id, '医療・健康', 80),
    (p_user_id, '住居費', 90), (p_user_id, '光熱費', 100),
    (p_user_id, '通信費', 110), (p_user_id, '交通・車両', 120),
    (p_user_id, '娯楽・趣味', 130), (p_user_id, '書籍・学習', 140),
    (p_user_id, 'サブスクリプション・会費', 150), (p_user_id, '交際費・贈答', 160),
    (p_user_id, 'こども・教育', 170), (p_user_id, 'ペット', 180),
    (p_user_id, '家電・家具', 190), (p_user_id, '旅行', 200),
    (p_user_id, '保険・税金・手数料', 210), (p_user_id, 'その他', 220)
  on conflict (user_id, name) do nothing;

  -- FR-21:リボ・キャッシング・分割の検知は、AI にもDBにも頼らず
  -- `DEFAULT_DETECTION_RULES`(features/classification/rules.ts)として
  -- TS側に固定してある(ADR-010・ADR-057)。ここでは何も投入しない。

  -- FR-15:給料日振替の既定順序(返済 → 投資 → 女遊び → 生活費)。
  -- 金額は本人が設定画面で調整する前提の初期値。ジャンルは本人が後から
  -- 選び直せるよう、ここでは未設定のままにする(ADR-057)。
  insert into public.transfer_rules
    (user_id, name, trigger, execution_order, amount_type, amount_yen, genre_id)
  values
    (p_user_id, '返済へ',       'payday', 1, 'fixed',     100000, null),
    (p_user_id, '投資へ',       'payday', 2, 'fixed',      20000, null),
    (p_user_id, '聖域枠へ',     'payday', 3, 'fixed',      40000, null),
    (p_user_id, '生活費へ',     'payday', 4, 'remainder',   null, null)
  on conflict (user_id, name) do nothing;

  -- FR-02:比較の基準となる「最低返済のみ」シナリオ
  insert into public.repayment_scenarios
    (user_id, name, strategy, monthly_budget_yen, is_baseline, sort_order)
  values
    (p_user_id, '最低返済のみ', 'minimum',   null,   true,  10),
    (p_user_id, '月10万円返済', 'avalanche', 100000, false, 20)
  on conflict (user_id, name) do nothing;

  -- ADR-006:負債の正確な内訳が判明するまでの仮置き3件。
  -- is_estimated = true とし、画面には「推定」バッジと「正確な値を入力する」
  -- 導線を出す(M1-2)。最低返済額は ADR-006 に定めが無いため、リボ・
  -- 消費者金融の一般的な水準から妥当な仮値を置いた(decisions.md に追記)。
  -- 既に debts が1件でもあれば(本人が入力・削除済み)何もしない。
  insert into public.debts
    (user_id, lender_name, kind, current_balance_yen, minimum_payment_yen, annual_rate, payment_day, is_estimated)
  select p_user_id, v.lender_name, v.kind, v.balance_yen, v.minimum_payment_yen, v.annual_rate, v.payment_day, true
  from (
    values
      ('カードA',     'revolving'::debt_kind,        400000, 10000, 0.15::numeric, 27),
      ('カードB',     'revolving'::debt_kind,         300000,  8000, 0.15::numeric, 27),
      ('消費者金融C', 'consumer_finance'::debt_kind, 300000, 10000, 0.18::numeric,  5)
  ) as v(lender_name, kind, balance_yen, minimum_payment_yen, annual_rate, payment_day)
  where not exists (select 1 from public.debts where user_id = p_user_id);
end;
$$;

comment on function public.seed_defaults(uuid) is
  'ジャンル・振替ルール・比較シナリオ・負債の初期値を投入する。ユーザー作成直後に一度だけ実行する。';


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
--   categories              → genres に統合(ADR-057。classification_rules・budgets
--                             も同時に廃止し、genre_id/budget_yen/must_pay へ集約)
--   classification_rules    → 廃止(ADR-057)。FR-21の危険検知だけ
--                             features/classification/rules.ts に固定で残る
--   transfer_rules          → transfer_rules(+ transfer_runs, transfer_run_items)
--   budgets                 → 廃止(ADR-057)。genres.budget_yen に統合
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
--   genres                  → ADR-056/ADR-057。唯一の分類(旧 categories を置換)
--   spending_plans          → ADR-058。カレンダーで選んだ期間のジャンル別支出目標
--   spending_plan_items     → ADR-058。目標の明細(AI提案額と本人の目標額)
-- =============================================================================
