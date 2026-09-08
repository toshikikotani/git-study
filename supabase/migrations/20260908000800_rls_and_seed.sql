-- =============================================================================
--  Row Level Security と初期データ投入
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000800_rls_and_seed.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

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
    'app_settings','accounts','categories','budgets','debts','import_adapters',
    'import_batches','transactions','classification_rules','debt_payments',
    'repayment_scenarios','transfer_rules','transfer_runs','transfer_run_items',
    'side_projects','side_work_logs','side_incomes','job_change_milestones',
    'investment_contributions','investment_snapshots','job_runs','daily_briefs',
    'brief_items','brief_excluded_items','alerts','app_checkins'
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
declare
  v_cat_sanctuary uuid;
  v_cat_living    uuid;
begin
  -- 設定(ADR-003〜005 の初期値は列 DEFAULT に持たせてある)
  insert into public.app_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- カテゴリ(FR-11 の初期値8種)
  insert into public.categories
    (user_id, code, name, kind, default_monthly_budget_yen, sort_order, is_system)
  values
    (p_user_id, 'fixed_cost',          '固定費',       'fixed_cost',          100000, 10, true),
    (p_user_id, 'living',              '生活費',       'living',               60000, 20, true),
    (p_user_id, 'sanctuary',           '女遊び(聖域)', 'sanctuary',           40000, 30, true),
    (p_user_id, 'waste',               '浪費',         'waste',                20000, 40, true),
    (p_user_id, 'investment_spending', '投資的支出',   'investment_spending',  10000, 50, true),
    (p_user_id, 'repayment',           '返済',         'repayment',              null, 60, true),
    (p_user_id, 'investment',          '投資',         'investment',             null, 70, true),
    (p_user_id, 'income',              '収入',         'income',                 null, 80, true),
    (p_user_id, 'transfer',            '口座間振替',   'transfer',               null, 90, true)
  on conflict (user_id, code) do nothing;

  select id into v_cat_sanctuary from public.categories
    where user_id = p_user_id and code = 'sanctuary';
  select id into v_cat_living from public.categories
    where user_id = p_user_id and code = 'living';

  -- FR-21:リボ・キャッシング・分割の検知ルール。
  -- AI ではなく決定的な正規表現で判定する(ADR-010)。見逃しが致命的なため
  -- priority を最上位に置き、他のどのルールより先に評価させる。
  insert into public.classification_rules
    (user_id, name, priority, match_type, pattern, set_payment_method, is_active)
  values
    (p_user_id, 'リボ払いの検知',       1, 'regex',
     '(リボ|ﾘﾎﾞ|revolving|リボルビング)',            'revolving',   true),
    (p_user_id, 'キャッシングの検知',   2, 'regex',
     '(キャッシング|ｷｬｯｼﾝｸﾞ|CASHING|カードローン|ATM借入)', 'cashing',     true),
    (p_user_id, '分割払いの検知',       3, 'regex',
     '(分割|[0-9]+回払|ボーナス払)',                  'installment', true)
  on conflict (user_id, name) do nothing;

  -- FR-15:給料日振替の既定順序(返済 → 投資 → 女遊び → 生活費)。
  -- 金額は本人が設定画面で調整する前提の初期値。
  insert into public.transfer_rules
    (user_id, name, trigger, execution_order, amount_type, amount_yen, category_id)
  values
    (p_user_id, '返済へ',       'payday', 1, 'fixed',     100000, null),
    (p_user_id, '投資へ',       'payday', 2, 'fixed',      20000, null),
    (p_user_id, '女遊び枠へ',   'payday', 3, 'fixed',      40000, v_cat_sanctuary),
    (p_user_id, '生活費へ',     'payday', 4, 'remainder',   null, v_cat_living)
  on conflict (user_id, name) do nothing;

  -- FR-02:比較の基準となる「最低返済のみ」シナリオ
  insert into public.repayment_scenarios
    (user_id, name, strategy, monthly_budget_yen, is_baseline, sort_order)
  values
    (p_user_id, '最低返済のみ', 'minimum',   null,   true,  10),
    (p_user_id, '月10万円返済', 'avalanche', 100000, false, 20)
  on conflict (user_id, name) do nothing;
end;
$$;

comment on function public.seed_defaults(uuid) is
  'カテゴリ・検知ルール・振替ルール・比較シナリオの初期値を投入する。ユーザー作成直後に一度だけ実行する。';

commit;
