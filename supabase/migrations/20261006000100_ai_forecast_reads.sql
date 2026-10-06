-- =============================================================================
--  ai_forecast_reads — AIの読み(着地の見込みへのAIの補正、本人発案、ADR-072)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20261006000100_ai_forecast_reads.sql は実際に適用される正。
-- =============================================================================

begin;

-- 月次レポートを作るたびに1行足す(上書きしない)。月が終わったら、その月の実際の着地と
-- 比べて「AIの読みが統計より当たったか」を数え、次からの補正の効かせ方に使う。
-- AIは補正の%を選ぶだけで、金額はアプリが計算する(N1)。
create table public.ai_forecast_reads (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  month            date        not null,
  as_of            date        not null,
  known_yen        integer     not null,
  stat_p10_yen     integer     not null,
  stat_p50_yen     integer     not null,
  stat_p90_yen     integer     not null,
  ai_percent       integer     not null,
  trust            numeric     not null,
  adjusted_p50_yen integer     not null,
  reason           text        not null,
  evidence         text[]      not null default '{}',
  created_at       timestamptz not null default now(),

  constraint ck_ai_forecast_reads_percent check (ai_percent between -20 and 30),
  constraint ck_ai_forecast_reads_trust check (trust >= 0 and trust <= 1)
);

create index ai_forecast_reads_user_month_idx on public.ai_forecast_reads (user_id, month);

commit;
