-- =============================================================================
--  ai_monthly_reports — AI月次レポート(浪費傾向のタイプ・気づき・アドバイス、
--  本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260921000300_ai_monthly_reports.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

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

-- 3.26 ai_monthly_reports — AI月次レポート(本人発案「AI関連もっと増やしたい。
-- もっと画期的な機能ない?」、ADR-031)
-- -----------------------------------------------------------------------------
-- 家計簿・診断(transaction_diagnoses)の蓄積データを1ヶ月分まとめてAIに渡し、
-- ①浪費傾向のタイプ(固定6分類、persona_type)、②実データに基づく気づき、
-- ③行動面の一般的なアドバイスを生成する。1ヶ月につき1行(再生成は upsert で
-- 上書き、過去のレポートを履歴として重ねて残す機能ではない)。医学的な性格
-- 診断やホルモン等の身体的な断定はさせない(本人の明示的な要望で除外)。
create table public.ai_monthly_reports (
  id                uuid                  primary key default gen_random_uuid(),
  user_id           uuid                  not null references auth.users(id) on delete cascade,
  month             date                  not null,

  persona_type      spending_persona_type not null,
  persona_reasoning text                  not null,
  insights          text[]                not null default '{}',
  advice            text[]                not null default '{}',

  created_at        timestamptz           not null default now(),

  constraint ck_ai_monthly_reports_month_is_first_day check (extract(day from month) = 1),
  constraint ck_ai_monthly_reports_persona_reasoning_not_blank check (btrim(persona_reasoning) <> ''),
  constraint ck_ai_monthly_reports_insights_not_empty check (array_length(insights, 1) > 0),
  constraint ck_ai_monthly_reports_advice_not_empty check (array_length(advice, 1) > 0)
);

create unique index ux_ai_monthly_reports_user_month on public.ai_monthly_reports (user_id, month);

commit;
