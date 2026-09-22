-- =============================================================================
--  未適用のマイグレーションを、1回のコピペでまとめて適用する(B-4/B-5/B-7/
--  B-10/B-12/B-13/B-14/B-15)
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
-- =============================================================================

begin;

-- 1. rescued_emails — 読み取れなかったメールの控え(B-4)
-- -----------------------------------------------------------------------------
create table if not exists public.rescued_emails (
  id              uuid               primary key default gen_random_uuid(),
  user_id         uuid               not null references auth.users(id) on delete cascade,
  source          transaction_source not null,
  subject         text,
  body            text               not null,
  extracted_count smallint           not null default 0,

  constraint ck_rescued_emails_extracted_count check (extracted_count >= 0),

  created_at      timestamptz        not null default now()
);

create index if not exists ix_rescued_emails_user_created
  on public.rescued_emails (user_id, created_at desc);

-- 2. net_worth_snapshots — 純資産の推移(B-5)
-- -----------------------------------------------------------------------------
create table if not exists public.net_worth_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  as_of                 date        not null,
  debt_balance_yen      bigint      not null,
  investment_value_yen  bigint      not null,
  created_at            timestamptz not null default now(),

  constraint ck_net_worth_debt_balance check (debt_balance_yen >= 0),
  constraint ck_net_worth_investment_value check (investment_value_yen >= 0)
);

create unique index if not exists ux_net_worth_snapshots_user_as_of
  on public.net_worth_snapshots (user_id, as_of);
create index if not exists ix_net_worth_snapshots_user_as_of_desc
  on public.net_worth_snapshots (user_id, as_of desc);

-- 3. transaction_splits — 明細を複数カテゴリへ分割(B-7)
-- -----------------------------------------------------------------------------
create table if not exists public.transaction_splits (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  transaction_id uuid        not null references public.transactions(id) on delete cascade,
  category_id    uuid        references public.categories(id) on delete set null,
  amount_yen     bigint      not null,
  note           text,
  created_at     timestamptz not null default now(),

  constraint ck_transaction_splits_amount_nonzero check (amount_yen <> 0)
);

create index if not exists ix_transaction_splits_transaction
  on public.transaction_splits (transaction_id);
create index if not exists ix_transaction_splits_user
  on public.transaction_splits (user_id);

-- 4. 既存テーブルへの列追加(B-12、レシート画像の保存先)
-- -----------------------------------------------------------------------------
alter table public.import_batches add column if not exists receipt_image_path text;
alter table public.app_settings add column if not exists google_backup_spreadsheet_id text;

-- 5. goals — AI相談で決めた目標(B-10)
-- -----------------------------------------------------------------------------
do $$ begin
  create type goal_status as enum ('active', 'achieved', 'abandoned');
exception when duplicate_object then null;
end $$;

create table if not exists public.goals (
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

create index if not exists ix_goals_user_status
  on public.goals (user_id, status, created_at desc);

drop trigger if exists trg_goals_updated_at on public.goals;
create trigger trg_goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- 6. transaction_diagnoses — 明細ごとの浪費/必要経費のAI診断(B-13)
-- -----------------------------------------------------------------------------
do $$ begin
  create type spending_verdict as enum ('waste', 'necessary');
exception when duplicate_object then null;
end $$;

create table if not exists public.transaction_diagnoses (
  id             uuid             primary key default gen_random_uuid(),
  user_id        uuid             not null references auth.users(id) on delete cascade,
  transaction_id uuid             not null references public.transactions(id) on delete cascade,

  verdict        spending_verdict not null,
  reasoning      text             not null,

  created_at     timestamptz      not null default now(),

  constraint ck_transaction_diagnoses_reasoning_not_blank check (btrim(reasoning) <> '')
);

create unique index if not exists ux_transaction_diagnoses_transaction
  on public.transaction_diagnoses (transaction_id);
create index if not exists ix_transaction_diagnoses_user
  on public.transaction_diagnoses (user_id);

-- 7. ai_monthly_reports — AI月次レポート(B-14)
-- -----------------------------------------------------------------------------
do $$ begin
  create type spending_persona_type as enum (
    'impulsive', 'steady', 'social', 'goal_oriented', 'frugal', 'balanced'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.ai_monthly_reports (
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

create unique index if not exists ux_ai_monthly_reports_user_month
  on public.ai_monthly_reports (user_id, month);

-- 8. ai_daily_reports — AI日次レポート(B-15)
-- -----------------------------------------------------------------------------
create table if not exists public.ai_daily_reports (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  report_date date        not null,

  insights    text[]      not null default '{}',
  advice      text[]      not null default '{}',

  created_at  timestamptz not null default now(),

  constraint ck_ai_daily_reports_insights_not_empty check (array_length(insights, 1) > 0),
  constraint ck_ai_daily_reports_advice_not_empty check (array_length(advice, 1) > 0)
);

create unique index if not exists ux_ai_daily_reports_user_date
  on public.ai_daily_reports (user_id, report_date);

-- 9. Row Level Security — 本人の行だけ(ADR-011)
-- -----------------------------------------------------------------------------
-- 上で作った全テーブルに同じ方針を一括で当てる。anon キーが漏れても他人の
-- データへ到達できない状態を既定にする(NFR-04)。
do $$
declare
  t text;
begin
  foreach t in array array[
    'rescued_emails', 'net_worth_snapshots', 'transaction_splits', 'goals',
    'transaction_diagnoses', 'ai_monthly_reports', 'ai_daily_reports'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
    execute format('drop policy if exists "own_rows" on public.%I;', t);
    execute format($p$
      create policy "own_rows" on public.%1$I
        for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()));
    $p$, t);
  end loop;
end $$;

commit;

-- =============================================================================
--  確認 — 下の表で status が全部 ok なら完了
-- =============================================================================
select
  t.name                                            as "テーブル",
  case when c.oid is null then 'NG: 作られていない'
       when not c.relrowsecurity then 'NG: RLS が無効'
       when not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = t.name and policyname = 'own_rows'
       ) then 'NG: ポリシーが無い'
       else 'ok' end                                as status
from (values
  ('rescued_emails'), ('net_worth_snapshots'), ('transaction_splits'), ('goals'),
  ('transaction_diagnoses'), ('ai_monthly_reports'), ('ai_daily_reports')
) as t(name)
left join pg_class c
  on c.relname = t.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
union all
select
  'app_settings.google_backup_spreadsheet_id',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings'
      and column_name = 'google_backup_spreadsheet_id'
  ) then 'ok' else 'NG: 列が無い' end
union all
select
  'import_batches.receipt_image_path',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_batches'
      and column_name = 'receipt_image_path'
  ) then 'ok' else 'NG: 列が無い' end
order by 1;
