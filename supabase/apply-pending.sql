-- =============================================================================
--  未適用のマイグレーションを、1回のコピペでまとめて適用する(ADR-058)
--
--  使い方:
--    1. https://supabase.com/dashboard で対象プロジェクトを開く
--    2. 左メニュー「SQL Editor」→「New query」
--    3. このファイルを全部コピーして貼り付け、Run(Ctrl+Enter)
--    4. 最後に出る表で、全部の行が ok になっていることを確認する
--
--  何度実行しても壊れない(既に適用済みの部分は黙って飛ばす)。
--  全体が1つのトランザクションなので、途中で失敗したら何も適用されない。
--
--  これは supabase/migrations/ の未適用分を機械的に連結したもので、内容の正は
--  あくまで supabase/migrations/。ずれていないことは
--  scripts/verify-apply-pending.sh が検証する(CI でも実行する)。
--
--  B-4/B-5/B-7/B-10/B-12/B-13/B-14/B-15/B-16 は2026-09-22に、ADR-056/057
--  (genres・categories 等の廃止と genre_id への一本化)までのマイグレーションは
--  2026-09-29に本人が適用済み。このファイルは以後、その時点で未適用だった
--  ものだけを持つ。
-- =============================================================================

begin;

-- 1. spending_plans / spending_plan_items — 期間つきの支出目標(ADR-058)
-- -----------------------------------------------------------------------------
-- 3.31 spending_plans / spending_plan_items — 期間つきの支出目標(本人発案、ADR-058)
--
--   カレンダーで選んだ期間(period_start〜period_end)について、ジャンルごとの
--   支出目標を持つ。AIが過去の支出と課題(予算超過・増加傾向・浪費判定・
--   必須ラベル)から目安を提案し(ai_suggested_yen、reason)、本人が
--   target_yen へ直す。step_percent は提案時の「改善の強さ」で、1回の
--   目標で削る幅の上限(徐々に改善するための歯止め)。ジャンルの恒常的な
--   月次予算(genres.budget_yen)とは別物で、期間ごとに立て直していく。
-- -----------------------------------------------------------------------------
create table if not exists public.spending_plans (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  period_start date        not null,
  period_end   date        not null,
  step_percent integer     not null default 10,
  created_at   timestamptz not null default now(),

  constraint ck_spending_plans_period check (period_end >= period_start),
  constraint ck_spending_plans_step   check (step_percent between 0 and 50)
);

create index if not exists ix_spending_plans_user on public.spending_plans (user_id, created_at desc);

create table if not exists public.spending_plan_items (
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

create unique index if not exists ux_spending_plan_items_plan_genre
  on public.spending_plan_items (plan_id, genre_id);
create index if not exists ix_spending_plan_items_user on public.spending_plan_items (user_id);

alter table public.spending_plans enable row level security;
alter table public.spending_plans force row level security;

drop policy if exists "own_rows" on public.spending_plans;
create policy "own_rows" on public.spending_plans
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.spending_plan_items enable row level security;
alter table public.spending_plan_items force row level security;

drop policy if exists "own_rows" on public.spending_plan_items;
create policy "own_rows" on public.spending_plan_items
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2. transactions.status / kind — 実績/予定・通常/特別費、分割の子のジャンル補完
-- -----------------------------------------------------------------------------
alter table public.transactions
  add column if not exists status text not null default 'actual',
  add column if not exists kind   text not null default 'normal';

do $$
begin
  alter table public.transactions
    add constraint ck_transactions_status check (status in ('actual', 'scheduled'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.transactions
    add constraint ck_transactions_kind check (kind in ('normal', 'special'));
exception when duplicate_object then null;
end $$;

update public.transactions
  set status = 'scheduled'
  where occurred_on > (now() at time zone 'Asia/Tokyo')::date
    and status <> 'scheduled';

update public.transaction_splits s
  set genre_id = t.genre_id
  from public.transactions t
  where s.transaction_id = t.id
    and s.genre_id is null
    and t.genre_id is not null;

update public.receipt_items i
  set genre_id = t.genre_id
  from public.transactions t
  where i.transaction_id = t.id
    and i.genre_id is null
    and t.genre_id is not null;

-- 3. genre_memory / transactions.branch_name・reconcile_diff_yen — レシートの分類の記憶
-- -----------------------------------------------------------------------------
alter table public.transactions
  add column if not exists branch_name        text,
  add column if not exists reconcile_diff_yen integer;

create table if not exists public.genre_memory (
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

create unique index if not exists ux_genre_memory_key
  on public.genre_memory (user_id, store_key, item_key);
create index if not exists ix_genre_memory_user on public.genre_memory (user_id);

alter table public.genre_memory enable row level security;
alter table public.genre_memory force row level security;

drop policy if exists "own_rows" on public.genre_memory;
create policy "own_rows" on public.genre_memory
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 4. receipt_captures — 読み取りに失敗したレシートの「入力待ち」(F7)
-- -----------------------------------------------------------------------------
create table if not exists public.receipt_captures (
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

create index if not exists ix_receipt_captures_user_status
  on public.receipt_captures (user_id, status, created_at desc);

alter table public.receipt_captures enable row level security;
alter table public.receipt_captures force row level security;

drop policy if exists "own_rows" on public.receipt_captures;
create policy "own_rows" on public.receipt_captures
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 5. transactions.kind に 'refund'(返品・返金)を足す
-- -----------------------------------------------------------------------------
alter table public.transactions drop constraint if exists ck_transactions_kind;
alter table public.transactions
  add constraint ck_transactions_kind check (kind in ('normal', 'special', 'refund'));

-- 6. genres にアイコン・色の列を足す(カテゴリ設定)
-- -----------------------------------------------------------------------------
alter table public.genres add column if not exists icon_key text;
alter table public.genres add column if not exists color_index smallint;

alter table public.genres drop constraint if exists ck_genres_color_index;
alter table public.genres
  add constraint ck_genres_color_index check (color_index is null or color_index between 1 and 10);

-- 7. app_settings.ai_enabled / ai_cache — AIゲートウェイ基盤(N1)
-- -----------------------------------------------------------------------------
alter table public.app_settings add column if not exists ai_enabled boolean not null default true;

create table if not exists public.ai_cache (
  cache_key      text        primary key,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  feature        text        not null,
  response_json  jsonb       not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create index if not exists ai_cache_user_id_idx on public.ai_cache (user_id);
create index if not exists ai_cache_expires_at_idx on public.ai_cache (expires_at);

alter table public.ai_cache enable row level security;
alter table public.ai_cache force row level security;

drop policy if exists "own_rows" on public.ai_cache;
create policy "own_rows" on public.ai_cache
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 8. genres.quick_entry_order / hidden_in_quick_entry — 手入力のカテゴリ格子(N2)
-- -----------------------------------------------------------------------------
alter table public.genres add column if not exists quick_entry_order integer;
alter table public.genres add column if not exists hidden_in_quick_entry boolean not null default false;

-- 9. fixed_cost_confirmations — 固定費の確認(N4)
-- -----------------------------------------------------------------------------
create table if not exists public.fixed_cost_confirmations (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  subscription_key text        not null,
  confirmed_at     timestamptz not null default now(),
  primary key (user_id, subscription_key)
);

alter table public.fixed_cost_confirmations enable row level security;
alter table public.fixed_cost_confirmations force row level security;

drop policy if exists "own_rows" on public.fixed_cost_confirmations;
create policy "own_rows" on public.fixed_cost_confirmations
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 10. ai_forecast_reads — AIの読み(着地の見込みへのAIの補正、ADR-072)
-- -----------------------------------------------------------------------------
-- 月次レポートを作るたびに1行足す(上書きしない)。月が終わったら、その月の実際の着地と
-- 比べて「AIの読みが統計より当たったか」を数え、次からの補正の効かせ方に使う。
create table if not exists public.ai_forecast_reads (
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

create index if not exists ai_forecast_reads_user_month_idx on public.ai_forecast_reads (user_id, month);

alter table public.ai_forecast_reads enable row level security;
alter table public.ai_forecast_reads force row level security;

drop policy if exists "own_rows" on public.ai_forecast_reads;
create policy "own_rows" on public.ai_forecast_reads
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 11. spending_promises — ジャンルの約束(「外食を週1回へらす」、ADR-075)
-- -----------------------------------------------------------------------------
-- ジャンル画面の「決める」で、月ごと・ジャンルごとに1行。決めた回数は予測に入り、
-- 月が終わったら、使った額が「約束どおりの見込み」に収まったか(守れたか)を見せる。
create table if not exists public.spending_promises (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  genre_id    uuid        not null references public.genres(id) on delete cascade,
  month       date        not null,
  per_week    smallint    not null,
  promised_on date        not null,
  usual_yen   integer     not null,
  limit_yen   integer     not null,
  created_at  timestamptz not null default now(),

  constraint uq_spending_promises_genre_month unique (user_id, genre_id, month),
  constraint ck_spending_promises_month check (extract(day from month) = 1),
  constraint ck_spending_promises_per_week check (per_week between 1 and 7),
  constraint ck_spending_promises_yen check (usual_yen >= 0 and limit_yen >= 0)
);

alter table public.spending_promises enable row level security;
alter table public.spending_promises force row level security;

drop policy if exists "own_rows" on public.spending_promises;
create policy "own_rows" on public.spending_promises
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 12. spending_promises に「これ以上は使わない」(per_week = 0)を許す(ADR-078)
-- -----------------------------------------------------------------------------
alter table public.spending_promises drop constraint if exists ck_spending_promises_per_week;
alter table public.spending_promises
  add constraint ck_spending_promises_per_week check (per_week between 0 and 7);

commit;

-- =============================================================================
--  確認 — 下の表で status が全部 ok なら完了
-- =============================================================================
select
  'spending_plans' as "テーブル",
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'spending_plans'
  ) then 'ok' else 'NG: テーブルが無い' end as status
union all
select
  'spending_plan_items',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'spending_plan_items'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'transactions.status / kind',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions'
      and column_name in ('status', 'kind')
  ) = 2 then 'ok' else 'NG: 列が無い' end
union all
select
  'genre_memory',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'genre_memory'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'receipt_captures',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'receipt_captures'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'genres.icon_key / color_index',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'genres'
      and column_name in ('icon_key', 'color_index')
  ) = 2 then 'ok' else 'NG: 列が無い' end
union all
select
  'app_settings.ai_enabled',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'ai_enabled'
  ) then 'ok' else 'NG: 列が無い' end
union all
select
  'ai_cache',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ai_cache'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'genres.quick_entry_order / hidden_in_quick_entry',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'genres'
      and column_name in ('quick_entry_order', 'hidden_in_quick_entry')
  ) = 2 then 'ok' else 'NG: 列が無い' end
union all
select
  'fixed_cost_confirmations',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'fixed_cost_confirmations'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'ai_forecast_reads',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ai_forecast_reads'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'spending_promises',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'spending_promises'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'spending_promises.per_week = 0(これ以上は使わない)',
  case when exists (
    select 1 from pg_constraint
    where conname = 'ck_spending_promises_per_week'
      and pg_get_constraintdef(oid) like '%>= 0%'
  ) then 'ok' else 'NG: 制約が古い' end;
