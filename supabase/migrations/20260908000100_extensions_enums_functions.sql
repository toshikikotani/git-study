-- =============================================================================
--  拡張 / ENUM 型 / 共通関数
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000100_extensions_enums_functions.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
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

commit;
