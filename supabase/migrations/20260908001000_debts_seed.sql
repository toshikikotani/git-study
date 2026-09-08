-- =============================================================================
--  seed_defaults() に負債の初期値(ADR-006)を追加
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908001000_debts_seed.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--
--  ── なぜ後から足すのか ──────────────────────────────────────
--  20260908000800_rls_and_seed.sql の seed_defaults() は、カテゴリ・
--  検知ルール・振替ルール・比較シナリオは投入していたが、ADR-006 が
--  決めた負債3件を入れ忘れていた。M1-2(負債の登録画面)の DoD
--  「ADR-006 の仮置き3件が表示される」を満たすには、ここが要る。
--
--  ── 冪等性について ──────────────────────────────────────────
--  debts には categories 等と違って (user_id, 何か) の一意制約が無い
--  (同じ借入先から複数の借入があり得るため)。代わりに「その本人の
--  debts が1件も無ければ入れる」という条件にする。本人が既に入力・
--  削除していれば、再実行しても何もしない。
-- =============================================================================

begin;

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

  -- カテゴリ(FR-11 の初期値)。
  --
  -- name はあくまで初期値であり、本人がいつでも変更できる(FR-13, ADR-016)。
  -- 変えても壊れないのは、コードとルールが参照するのが code と kind だけだからである。
  -- 予算額もここに置く。app_settings 側には持たない(二重定義を避ける)。
  -- show_on_home はホーム最上部に残額を出す枠。これも本人が選び直せる(FR-61)。
  insert into public.categories
    (user_id, code, name, kind, default_monthly_budget_yen, sort_order, is_system, show_on_home)
  values
    (p_user_id, 'fixed_cost',          '固定費',       'fixed_cost',          100000, 10, true, false),
    (p_user_id, 'living',              '生活費',       'living',               60000, 20, true, true),
    (p_user_id, 'sanctuary',           '聖域',         'sanctuary',            40000, 30, true, true),
    (p_user_id, 'waste',               '浪費',         'waste',                20000, 40, true, false),
    (p_user_id, 'investment_spending', '投資的支出',   'investment_spending',  10000, 50, true, false),
    (p_user_id, 'repayment',           '返済',         'repayment',              null, 60, true, false),
    (p_user_id, 'investment',          '投資',         'investment',             null, 70, true, false),
    (p_user_id, 'income',              '収入',         'income',                 null, 80, true, false),
    (p_user_id, 'transfer',            '口座間振替',   'transfer',               null, 90, true, false)
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
    (p_user_id, '聖域枠へ',     'payday', 3, 'fixed',      40000, v_cat_sanctuary),
    (p_user_id, '生活費へ',     'payday', 4, 'remainder',   null, v_cat_living)
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
  'カテゴリ・検知ルール・振替ルール・比較シナリオ・負債の初期値を投入する。ユーザー作成直後に一度だけ実行する。';

commit;
