-- =============================================================================
--  完済シミュレーション関数とビュー
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000700_functions_and_views.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- =============================================================================
--  5. 完済シミュレーション(FR-02, FR-04)
--
--   利息計算は「毎月末に残高 × 年利 ÷ 12 を単利で加算し、返済は利息 → 元本の順に
--   充当する」モデル。日割り計算より粗いが、比較目的には十分で、本人が検算できる。
--   円未満は floor(切り捨て)で統一する。
-- =============================================================================

-- 単一債務の償還スケジュール
create or replace function public.simulate_debt_payoff(
  p_debt_id             uuid,
  p_monthly_payment_yen bigint,
  p_max_months          integer default 600
)
returns table (
  month_index         integer,
  due_on              date,
  opening_balance_yen bigint,
  interest_yen        bigint,
  principal_yen       bigint,
  payment_yen         bigint,
  closing_balance_yen bigint
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_balance  bigint;
  v_rate     numeric;
  v_day      smallint;
  v_interest bigint;
  v_payment  bigint;
  v_i        integer := 0;
begin
  select d.current_balance_yen, d.annual_rate, d.payment_day
    into v_balance, v_rate, v_day
  from public.debts d
  where d.id = p_debt_id;

  if v_balance is null then
    raise exception '債務 % が見つかりません', p_debt_id;
  end if;
  if p_monthly_payment_yen <= 0 then
    raise exception '月額返済額は正の値である必要があります(指定値: %)', p_monthly_payment_yen;
  end if;

  while v_balance > 0 and v_i < p_max_months loop
    v_i := v_i + 1;

    v_interest := floor(v_balance * v_rate / 12)::bigint;
    v_payment  := least(p_monthly_payment_yen, v_balance + v_interest);

    if v_payment <= v_interest then
      raise exception
        '月額 % 円では利息 % 円を下回るため完済できません(債務 %)',
        p_monthly_payment_yen, v_interest, p_debt_id;
    end if;

    month_index         := v_i;
    -- 支払日は 29〜31 日を月末差異で崩さないよう 28 日に丸める
    due_on              := public.month_start_jst(v_i) + (least(v_day, 28) - 1);
    opening_balance_yen := v_balance;
    interest_yen        := v_interest;
    payment_yen         := v_payment;
    principal_yen       := v_payment - v_interest;

    v_balance           := v_balance - principal_yen;
    closing_balance_yen := v_balance;

    return next;
  end loop;

  if v_balance > 0 then
    raise exception '% ヶ月以内に完済しません(残高 % 円)', p_max_months, v_balance;
  end if;
end;
$$;

comment on function public.simulate_debt_payoff(uuid, bigint, integer) is
  'FR-02:単一債務について、指定した月額返済額での償還スケジュールを返す。';


-- 全債務の合算シミュレーション(戦略込み)
create or replace function public.simulate_total_payoff(
  p_user_id            uuid,
  p_monthly_budget_yen bigint,
  p_strategy           repayment_strategy default 'avalanche',
  p_max_months         integer default 600
)
returns table (
  month_index          integer,
  month_on             date,
  opening_total_yen    bigint,
  interest_total_yen   bigint,
  principal_total_yen  bigint,
  payment_total_yen    bigint,
  closing_total_yen    bigint,
  debts_remaining      integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_bal      bigint[] := '{}';
  v_rate     numeric[] := '{}';
  v_min      bigint[]  := '{}';
  v_n        integer;
  v_i        integer := 0;
  k          integer;
  v_budget   bigint;
  v_interest bigint;
  v_pay      bigint;
  v_opening  bigint;
  v_closing  bigint;
  v_int_sum  bigint;
  v_pay_sum  bigint;
  r          record;
begin
  -- 戦略ごとの充当順に並べて配列へ読み込む。
  -- avalanche は金利降順、snowball は残高昇順。どちらも順序は期間中不変。
  for r in
    select d.current_balance_yen, d.annual_rate, d.minimum_payment_yen
    from public.debts d
    where d.user_id = p_user_id
      and d.status = 'active'
      and d.current_balance_yen > 0
    order by
      case when p_strategy = 'snowball' then d.current_balance_yen end asc nulls last,
      case when p_strategy <> 'snowball' then d.annual_rate end desc nulls last,
      d.id
  loop
    v_bal  := array_append(v_bal,  r.current_balance_yen);
    v_rate := array_append(v_rate, r.annual_rate);
    v_min  := array_append(v_min,  r.minimum_payment_yen);
  end loop;

  v_n := coalesce(array_length(v_bal, 1), 0);
  if v_n = 0 then
    return;
  end if;

  -- 'minimum' 戦略(FR-02 の比較対象)では月額予算を指定させず、各債務の最低返済額
  -- だけを充てる。債務が消えるほど月々の支払総額も減る、という実際の挙動を再現する。
  if p_strategy <> 'minimum'
     and (p_monthly_budget_yen is null or p_monthly_budget_yen <= 0) then
    raise exception '月額予算は正の値である必要があります(指定値: %)', p_monthly_budget_yen;
  end if;

  while v_i < p_max_months loop
    select coalesce(sum(b), 0) into v_opening from unnest(v_bal) as b;
    exit when v_opening <= 0;

    v_i := v_i + 1;
    v_int_sum := 0;
    v_pay_sum := 0;

    -- (1) 利息を計上して残高に加える
    for k in 1 .. v_n loop
      if v_bal[k] > 0 then
        v_interest := floor(v_bal[k] * v_rate[k] / 12)::bigint;
        v_bal[k]   := v_bal[k] + v_interest;
        v_int_sum  := v_int_sum + v_interest;
      end if;
    end loop;

    -- (2) 全債務へ最低返済額を充てる。
    --     予算は毎月ここでリセットする(前月の残りを持ち越さない)。
    if p_strategy = 'minimum' then
      -- 残っている債務の最低返済額の合計。完済した債務の分は自動的に外れる
      select coalesce(sum(v_min[i]), 0) into v_budget
      from generate_subscripts(v_bal, 1) as i
      where v_bal[i] > 0;
    else
      v_budget := p_monthly_budget_yen;
    end if;

    for k in 1 .. v_n loop
      exit when v_budget <= 0;
      if v_bal[k] > 0 then
        v_pay     := least(v_min[k], v_bal[k], v_budget);
        v_bal[k]  := v_bal[k] - v_pay;
        v_budget  := v_budget - v_pay;
        v_pay_sum := v_pay_sum + v_pay;
      end if;
    end loop;

    -- (3) 余剰を戦略順(配列順)に充てる。
    --     'minimum' は最低返済のみを再現する比較対象なので、余剰充当を行わない。
    if p_strategy <> 'minimum' then
      for k in 1 .. v_n loop
        exit when v_budget <= 0;
        if v_bal[k] > 0 then
          v_pay     := least(v_budget, v_bal[k]);
          v_bal[k]  := v_bal[k] - v_pay;
          v_budget  := v_budget - v_pay;
          v_pay_sum := v_pay_sum + v_pay;
        end if;
      end loop;
    end if;

    select coalesce(sum(b), 0) into v_closing from unnest(v_bal) as b;

    -- 残高が減らない月額は完済に到達しない。無限ループにせず明示的に落とす。
    if v_closing >= v_opening then
      raise exception
        '月額 % 円では残高が減りません(月初 % 円 → 月末 % 円)。利息 % 円を上回る返済が必要です。',
        coalesce(p_monthly_budget_yen, 0), v_opening, v_closing, v_int_sum;
    end if;

    month_index         := v_i;
    month_on            := public.month_start_jst(v_i);
    opening_total_yen   := v_opening;
    interest_total_yen  := v_int_sum;
    payment_total_yen   := v_pay_sum;
    principal_total_yen := v_pay_sum - v_int_sum;
    closing_total_yen   := v_closing;

    select count(*)::integer into debts_remaining from unnest(v_bal) as b where b > 0;

    return next;
  end loop;
end;
$$;

comment on function public.simulate_total_payoff(uuid, bigint, repayment_strategy, integer) is
  'FR-02/FR-04:全債務を合算し、戦略(アバランチ/スノーボール/最低返済のみ)に沿って配分した償還スケジュールを返す。';


-- =============================================================================
--  6. ビュー
--
--   security_invoker = true により、呼び出し元の権限で RLS が評価される。
-- =============================================================================

-- 負債の全体像。ホーム画面の完済カウントダウン(FR-03)の元データ
create view public.v_debt_overview
with (security_invoker = true) as
select
  d.user_id,
  count(*)::integer                                     as active_debt_count,
  sum(d.current_balance_yen)                            as total_balance_yen,
  sum(d.minimum_payment_yen)                            as total_minimum_payment_yen,
  -- 残高で加重した平均年利。単純平均は少額高金利の債務を過大評価する
  case when sum(d.current_balance_yen) > 0
       then round(sum(d.annual_rate * d.current_balance_yen)
                  / sum(d.current_balance_yen), 4)
  end                                                   as weighted_annual_rate,
  max(d.annual_rate)                                    as max_annual_rate,
  bool_or(d.is_estimated)                               as has_estimated_values,
  min(d.payment_day)                                    as next_payment_day
from public.debts d
where d.status = 'active'
group by d.user_id;

comment on view public.v_debt_overview is
  'has_estimated_values が true のあいだ、完済予定日を確定値として表示してはならない(ADR-006)。';


-- 当月のカテゴリ別支出。FR-14 / FR-20 の元データ
create view public.v_monthly_category_spend
with (security_invoker = true) as
select
  t.user_id,
  date_trunc('month', t.occurred_on)::date              as month,
  t.category_id,
  c.code                                                as category_code,
  c.name                                                as category_name,
  c.kind                                                as category_kind,
  -- 支出は負で入っているので、正の「使った額」に反転して返す
  sum(case when t.amount_yen < 0 then -t.amount_yen else 0 end) as spent_yen,
  sum(case when t.amount_yen > 0 then  t.amount_yen else 0 end) as received_yen,
  count(*)::integer                                     as transaction_count
from public.transactions t
left join public.categories c on c.id = t.category_id
where not t.is_transfer
  and t.review_status <> 'ignored'
group by t.user_id, date_trunc('month', t.occurred_on)::date,
         t.category_id, c.code, c.name, c.kind;


-- 当月の予算消化状況。FR-14「使える残額」/ FR-20 の 70% 判定
create view public.v_current_month_budget_status
with (security_invoker = true) as
with base as (
  select
    c.user_id,
    c.id                as category_id,
    c.code,
    c.name,
    c.kind,
    coalesce(b.amount_yen, c.default_monthly_budget_yen) as budget_yen,
    coalesce(b.carry_over_yen, 0)                        as carry_over_yen
  from public.categories c
  left join public.budgets b
    on  b.category_id = c.id
    and b.month = public.month_start_jst()
  where c.is_active
)
select
  base.user_id,
  base.category_id,
  base.code,
  base.name,
  base.kind,
  base.budget_yen,
  base.carry_over_yen,
  coalesce(s.spent_yen, 0)                               as spent_yen,
  case when base.budget_yen is not null
       then base.budget_yen + base.carry_over_yen - coalesce(s.spent_yen, 0)
  end                                                    as remaining_yen,
  case when coalesce(base.budget_yen, 0) > 0
       then round(coalesce(s.spent_yen, 0)::numeric / base.budget_yen, 3)
  end                                                    as usage_ratio
from base
left join public.v_monthly_category_spend s
  on  s.user_id     = base.user_id
  and s.category_id = base.category_id
  and s.month       = public.month_start_jst();

comment on view public.v_current_month_budget_status is
  'FR-14:remaining_yen を「あと〇円使える」と肯定形で表示する。FR-20:usage_ratio >= 0.7 でアラート。';


-- 連続確認日数(FR-62)。途切れても責めず、再開だけを提示するための素材
create view public.v_checkin_streak
with (security_invoker = true) as
with islands as (
  select
    user_id,
    checked_on,
    checked_on - (row_number() over (partition by user_id order by checked_on))::integer
      as island_key
  from public.app_checkins
),
grouped as (
  select user_id, island_key, count(*)::integer as length, max(checked_on) as last_day
  from islands
  group by user_id, island_key
)
select
  user_id,
  coalesce(max(length) filter (where last_day >= public.today_jst() - 1), 0)
                                       as current_streak_days,
  max(length)                          as longest_streak_days,
  max(last_day)                        as last_checkin_on
from grouped
group by user_id;

commit;
