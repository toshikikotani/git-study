-- =============================================================================
--  未適用のマイグレーションを、1回のコピペでまとめて適用する(B-17/B-18、ADR-057)
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
--  B-4/B-5/B-7/B-10/B-12/B-13/B-14/B-15/B-16 は2026-09-22に本人が適用済み
--  (P10-30)。このファイルは以後、その時点で未適用だったものだけを持つ。
--
--  ADR-057(本人発案「今までの生活費・浪費などユーザー定義のカテゴリ分けを
--  完全に廃止し、ジャンルを唯一のカテゴリにする」)により、当初 ADR-056 で
--  追加した transaction_genres・receipt_item_genres(明細/品目とジャンルの
--  中間テーブル)は不要になった——ジャンルが唯一の分類になった以上、
--  transactions・receipt_items が直接 genre_id 列を持てば済むため。ここでは
--  中間テーブルを経由せず、最初から直接列として持たせる形にまとめてある
--  (本番へはまだ一度も適用していないため、経由した跡を残す必要がない)。
--  同時に、旧来の主観的カテゴリ(categories・classification_rules・budgets)を
--  廃止する。
-- =============================================================================

begin;

-- 1. genres — 支出の唯一の分類(本人発案、ADR-056/ADR-057)
-- -----------------------------------------------------------------------------
create table if not exists public.genres (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  sort_order   integer     not null default 0,
  -- 月次予算(本人発案「カテゴリのそれぞれの値段設定」)。未設定なら無制限。
  budget_yen   bigint,
  -- ホーム画面に残額を出すジャンルか(旧 categories.show_on_home、FR-14, FR-61)。
  show_on_home boolean     not null default false,
  created_at   timestamptz not null default now(),

  constraint ck_genres_name_not_blank check (btrim(name) <> ''),
  constraint ck_genres_budget check (budget_yen is null or budget_yen >= 0)
);

create unique index if not exists ux_genres_user_name on public.genres (user_id, name);
create index if not exists ix_genres_user on public.genres (user_id, sort_order);
create index if not exists ix_genres_show_on_home on public.genres (user_id, sort_order)
  where show_on_home;

alter table public.genres enable row level security;
alter table public.genres force row level security;

drop policy if exists "own_rows" on public.genres;
create policy "own_rows" on public.genres
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2. receipt_items へ商品分類(自由記述)を追加(B-18、ADR-036)
-- -----------------------------------------------------------------------------
alter table public.receipt_items
  add column if not exists product_type text;

-- 3. transaction_expense_subtypes — 生活費の小分類(B-18、ADR-036)
-- -----------------------------------------------------------------------------
create table if not exists public.transaction_expense_subtypes (
  transaction_id uuid        primary key references public.transactions(id) on delete cascade,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  subtype        text        not null,
  created_at     timestamptz not null default now(),

  constraint ck_transaction_expense_subtypes_not_blank check (btrim(subtype) <> '')
);

create index if not exists ix_transaction_expense_subtypes_user
  on public.transaction_expense_subtypes (user_id);

alter table public.transaction_expense_subtypes enable row level security;
alter table public.transaction_expense_subtypes force row level security;

drop policy if exists "own_rows" on public.transaction_expense_subtypes;
create policy "own_rows" on public.transaction_expense_subtypes
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 4. categories・classification_rules・budgets の廃止、genres への一本化(ADR-057)
-- -----------------------------------------------------------------------------
-- transactions.category_id を落とす前に、それに依存するビューを先に落とす
-- 必要がある(依存関係の都合で順序が固定)。
drop view if exists public.v_current_month_budget_status;
drop view if exists public.v_monthly_category_spend;

alter table public.transactions
  drop constraint if exists ck_transactions_classified_has_category;
alter table public.transactions
  drop constraint if exists fk_transactions_matched_rule;
drop index if exists public.ix_transactions_matched_rule;
drop index if exists public.ix_transactions_user_category_occurred;

alter table public.transactions
  drop column if exists matched_rule_id,
  drop column if exists category_id,
  add column if not exists genre_id uuid references public.genres(id) on delete set null,
  -- 本人発案「絶対払わざるを得ないもの」に明細1件ごとに付けるラベル
  -- (ジャンルとは独立した軸。ADR-057)。
  add column if not exists must_pay boolean not null default false;

alter table public.transactions
  drop constraint if exists ck_transactions_classified_has_genre;
alter table public.transactions
  add constraint ck_transactions_classified_has_genre
    check (classified_by = 'unclassified' or genre_id is not null);

drop index if exists public.ix_transactions_user_genre_occurred;
create index ix_transactions_user_genre_occurred
  on public.transactions (user_id, genre_id, occurred_on desc);

alter table public.transfer_rules
  drop column if exists category_id,
  add column if not exists genre_id uuid references public.genres(id) on delete set null;

alter table public.transaction_splits
  drop column if exists category_id,
  add column if not exists genre_id uuid references public.genres(id) on delete set null;

alter table public.receipt_items
  drop column if exists category_id,
  add column if not exists genre_id uuid references public.genres(id) on delete set null;

alter table public.alerts
  drop column if exists category_id,
  add column if not exists genre_id uuid references public.genres(id) on delete set null;

drop table if exists public.budgets;
drop table if exists public.classification_rules;
drop table if exists public.categories;
drop type if exists category_kind;

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

commit;

-- =============================================================================
--  確認 — 下の表で status が全部 ok なら完了
-- =============================================================================
select
  'genres' as "テーブル・列",
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'genres'
  ) then 'ok' else 'NG: テーブルが無い' end as status
union all
select
  'transactions.genre_id',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions'
      and column_name = 'genre_id'
  ) then 'ok' else 'NG: 列が無い' end
union all
select
  'transactions.must_pay',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions'
      and column_name = 'must_pay'
  ) then 'ok' else 'NG: 列が無い' end
union all
select
  'receipt_items.genre_id',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'receipt_items'
      and column_name = 'genre_id'
  ) then 'ok' else 'NG: 列が無い' end
union all
select
  'receipt_items.product_type',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'receipt_items'
      and column_name = 'product_type'
  ) then 'ok' else 'NG: 列が無い' end
union all
select
  'transaction_expense_subtypes',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transaction_expense_subtypes'
  ) then 'ok' else 'NG: テーブルが無い' end
union all
select
  'categories が廃止されている',
  case when not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'categories'
  ) then 'ok' else 'NG: まだ残っている' end
union all
select
  'classification_rules が廃止されている',
  case when not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'classification_rules'
  ) then 'ok' else 'NG: まだ残っている' end
union all
select
  'budgets が廃止されている',
  case when not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'budgets'
  ) then 'ok' else 'NG: まだ残っている' end;
