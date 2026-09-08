\set ON_ERROR_STOP on
\timing off

-- ユーザーを作ってシード
insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'test@example.com');

select public.seed_defaults('11111111-1111-1111-1111-111111111111');

\echo '--- カテゴリ ---'
select code, name, kind, default_monthly_budget_yen
from public.categories order by sort_order;

\echo '--- 検知ルール(FR-21) ---'
select priority, name, set_payment_method from public.classification_rules order by priority;

\echo '--- 振替ルール(FR-15) ---'
select execution_order, name, amount_type, amount_yen from public.transfer_rules order by execution_order;

-- ADR-006 の仮置き負債
insert into public.accounts (id, user_id, name, kind, purpose)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'メイン銀行', 'bank', 'salary');

insert into public.debts (id, user_id, lender_name, kind, current_balance_yen,
                          minimum_payment_yen, annual_rate, payment_day)
values
 ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
  'カードA','revolving',400000,10000,0.1500,27),
 ('dddddddd-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
  'カードB','revolving',300000, 8000,0.1500,27),
 ('dddddddd-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
  '消費者金融C','consumer_finance',300000,9000,0.1800,5);

\echo '--- 負債サマリ(加重平均金利)---'
select active_debt_count, total_balance_yen, total_minimum_payment_yen,
       weighted_annual_rate, has_estimated_values
from public.v_debt_overview;

\echo '--- FR-02: 単一債務 月2万円返済(先頭3ヶ月と最終月)---'
select month_index, due_on, opening_balance_yen, interest_yen, principal_yen, closing_balance_yen
from public.simulate_debt_payoff('dddddddd-0000-0000-0000-000000000001', 20000)
where month_index <= 3
   or closing_balance_yen = 0;

\echo '--- FR-02: 全債務 アバランチ 月10万円 ---'
select count(*) as months,
       max(month_on) as payoff_month,
       sum(interest_total_yen) as total_interest_yen,
       sum(payment_total_yen)  as total_paid_yen
from public.simulate_total_payoff('11111111-1111-1111-1111-111111111111', 100000, 'avalanche');

\echo '--- FR-02: 全債務 スノーボール 月10万円(比較)---'
select count(*) as months,
       sum(interest_total_yen) as total_interest_yen
from public.simulate_total_payoff('11111111-1111-1111-1111-111111111111', 100000, 'snowball');

\echo '--- FR-02: 最低返済のみ(比較の基準)---'
select count(*) as months,
       sum(interest_total_yen) as total_interest_yen,
       sum(payment_total_yen)  as total_paid_yen
from public.simulate_total_payoff('11111111-1111-1111-1111-111111111111', null, 'minimum');

\echo '--- FR-04: 借り換えで年8%になった場合(全債務の金利を上書き)---'
begin;
update public.debts set annual_rate = 0.0800
 where user_id = '11111111-1111-1111-1111-111111111111';
select count(*) as months, sum(interest_total_yen) as total_interest_yen
from public.simulate_total_payoff('11111111-1111-1111-1111-111111111111', 100000, 'avalanche');
rollback;

-- 明細の投入と重複排除
\echo '--- FR-10: 重複排除(fingerprint)---'
insert into public.transactions (user_id, account_id, occurred_on, amount_yen, description, source)
values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
        '2026-09-03', -3500, 'ローソン 渋谷', 'csv');
do $$
begin
  insert into public.transactions (user_id, account_id, occurred_on, amount_yen, description, source)
  values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
          '2026-09-03', -3500, 'ローソン  渋谷', 'csv');   -- 空白違いの同一明細
  raise exception 'FAIL: 重複明細が入ってしまった';
exception when unique_violation then
  raise notice 'OK: 空白差の重複を fingerprint で排除した';
end $$;

\echo '--- 制約テスト ---'
do $$
declare
  u uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- 金利をパーセント値で入れる事故を止める
  begin
    insert into public.debts (user_id, lender_name, kind, current_balance_yen,
                              minimum_payment_yen, annual_rate, payment_day)
    values (u, 'ミス入力', 'other', 100000, 5000, 15.0, 10);
    raise exception 'FAIL: 金利 15.0 が通ってしまった';
  exception when check_violation then
    raise notice 'OK: 金利のパーセント値入力を拒否した(ck_debts_rate)';
  end;

  -- 完済なのに残高が残る矛盾
  begin
    update public.debts set status = 'paid_off', paid_off_on = current_date
     where id = 'dddddddd-0000-0000-0000-000000000001';
    raise exception 'FAIL: 残高ありで完済にできてしまった';
  exception when check_violation then
    raise notice 'OK: 残高ありの完済を拒否した(ck_debts_paid_off_zero)';
  end;

  -- 0円明細
  begin
    insert into public.transactions (user_id, account_id, occurred_on, amount_yen, description, source)
    values (u, 'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-04', 0, 'ゼロ円', 'csv');
    raise exception 'FAIL: 0円明細が通ってしまった';
  exception when check_violation then
    raise notice 'OK: 0円明細を拒否した(ck_transactions_amount_nonzero)';
  end;

  -- AI 分類なのに確信度が無い
  begin
    insert into public.transactions (user_id, account_id, occurred_on, amount_yen,
                                     description, source, classified_by, category_id)
    values (u, 'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-05', -1200, 'テスト', 'csv',
            'ai', (select id from public.categories where code='living'));
    raise exception 'FAIL: 確信度なしの AI 分類が通ってしまった';
  exception when check_violation then
    raise notice 'OK: 確信度なしの AI 分類を拒否した(ck_transactions_ai_needs_confidence)';
  end;

  -- 振替ルール: fixed なのに金額が無い
  begin
    insert into public.transfer_rules (user_id, name, execution_order, amount_type)
    values (u, '壊れたルール', 9, 'fixed');
    raise exception 'FAIL: 金額なしの fixed ルールが通ってしまった';
  exception when check_violation then
    raise notice 'OK: 金額なしの fixed 振替ルールを拒否した(ck_transfer_rules_amount_shape)';
  end;

  -- app_settings に Webhook URL の実値を入れる事故
  begin
    update public.app_settings set discord_webhook_env_key = 'https://discord.com/api/webhooks/xxx'
     where user_id = u;
    raise exception 'FAIL: 秘密情報の実値が保存できてしまった';
  exception when check_violation then
    raise notice 'OK: 環境変数名ではなく URL 実値の保存を拒否した(ck_app_settings_env_key_is_name)';
  end;

  -- 月初以外の予算月
  begin
    insert into public.budgets (user_id, category_id, month, amount_yen)
    values (u, (select id from public.categories where code='living'), '2026-09-15', 60000);
    raise exception 'FAIL: 月初以外の budgets.month が通ってしまった';
  exception when check_violation then
    raise notice 'OK: 月初以外の予算月を拒否した(ck_budgets_month_is_first_day)';
  end;

  -- 返済額が利息を下回るケース
  begin
    perform * from public.simulate_debt_payoff('dddddddd-0000-0000-0000-000000000001', 1000);
    raise exception 'FAIL: 完済不能な月額でエラーにならなかった';
  exception when raise_exception then
    raise notice 'OK: 完済不能な月額をエラーにした(simulate_debt_payoff)';
  end;
end $$;

\echo '--- FR-14: 予算消化状況 ---'
insert into public.budgets (user_id, category_id, month, amount_yen)
select '11111111-1111-1111-1111-111111111111', id, public.month_start_jst(), 40000
from public.categories where code = 'sanctuary';

insert into public.transactions (user_id, account_id, occurred_on, amount_yen, description,
                                 source, category_id, classified_by, confidence, review_status)
select '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
       public.month_start_jst() + 5, -30000, 'キャバクラ', 'csv',
       id, 'ai', 0.910, 'auto_ok'
from public.categories where code = 'sanctuary';

select code, budget_yen, spent_yen, remaining_yen, usage_ratio
from public.v_current_month_budget_status
where code in ('sanctuary','living','waste')
order by code;

\echo '--- FR-62: ストリーク ---'
insert into public.app_checkins (user_id, checked_on)
select '11111111-1111-1111-1111-111111111111', public.today_jst() - g
from generate_series(0, 4) g;
insert into public.app_checkins (user_id, checked_on)
values ('11111111-1111-1111-1111-111111111111', public.today_jst() - 10);

select current_streak_days, longest_streak_days, last_checkin_on
from public.v_checkin_streak;

\echo '--- RLS: 他人のデータが見えないこと ---'
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'other@example.com');
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- SET LOCAL はトランザクション内でしか効かない
begin;
set local role authenticated;

set local "test.user_id" = '22222222-2222-2222-2222-222222222222';
select count(*) as debts_visible_to_other_user,
       (select count(*) from public.transactions) as tx_visible_to_other_user
from public.debts;

set local "test.user_id" = '11111111-1111-1111-1111-111111111111';
select count(*) as debts_visible_to_owner,
       (select count(*) from public.transactions) as tx_visible_to_owner
from public.debts;
commit;

\echo '--- 全テーブルで RLS が有効か(tables_without_rls は 0 であること)---'
select count(*) filter (where not c.relrowsecurity) as tables_without_rls,
       count(*)                                     as total_tables
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r';
