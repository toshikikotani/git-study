-- =============================================================================
--  副業・投資・バッチ実行ログ
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000500_side_investment_jobs.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

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

commit;
