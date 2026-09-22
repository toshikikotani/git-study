-- =============================================================================
--  ai_daily_reports — AI日次レポート(今日の気づき・アドバイス、本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260921000500_ai_daily_reports.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.27 ai_daily_reports — AI日次レポート(本人発案「日次レポートと月次
-- レポートどっちも出力できるように」、ADR-032)
-- -----------------------------------------------------------------------------
-- 今日1日分の実データ(支出・カテゴリ・診断結果)をAIに渡し、気づきと
-- アドバイスを生成する。ai_monthly_reports と異なり persona_type を持たない
-- ——1日分のデータでは浪費傾向のタイプ判定にノイズが大きすぎるため、
-- タイプ判定は月次レポートに一本化する(ADR-032)。1日につき1行(再生成は
-- upsert で上書き、過去のレポートを履歴として重ねて残す機能ではない)。
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

commit;
