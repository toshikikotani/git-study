-- =============================================================================
--  朝配信・アラート・チェックイン・updated_at トリガ
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000600_briefs_alerts_checkins.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

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

commit;
