\set ON_ERROR_STOP on
\timing off

-- ユーザーを作ってシード
insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'test@example.com');

select public.seed_defaults('11111111-1111-1111-1111-111111111111');

\echo '--- ジャンル(ADR-057:唯一の分類) ---'
select name, sort_order, budget_yen, show_on_home
from public.genres order by sort_order;

-- FR-21(リボ・キャッシング・分割の検知)は DB に保存せず
-- features/classification/rules.ts の DEFAULT_DETECTION_RULES に固定してある
-- (ADR-010・ADR-057)。よってここでは検証しない(vitest 側で検証する)。

\echo '--- 振替ルール(FR-15) ---'
select execution_order, name, amount_type, amount_yen from public.transfer_rules order by execution_order;

insert into public.accounts (id, user_id, name, kind, purpose)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'メイン銀行', 'bank', 'salary');

\echo '--- 貯金目標(ADR-081:数え始める日は今日が既定)---'
insert into public.goals (user_id, title, target_amount_yen, target_date)
values ('11111111-1111-1111-1111-111111111111', '旅行', 120000, public.today_jst() + 180);
select title, target_amount_yen, start_on = public.today_jst() as starts_today
from public.goals;

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
                                     description, source, classified_by, genre_id)
    values (u, 'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-05', -1200, 'テスト', 'csv',
            'ai', (select id from public.genres where user_id = u and name = '食料品'));
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

  -- ジャンルの予算にマイナス値
  begin
    update public.genres set budget_yen = -1000
     where user_id = u and name = '食料品';
    raise exception 'FAIL: マイナスの genres.budget_yen が通ってしまった';
  exception when check_violation then
    raise notice 'OK: マイナスの予算を拒否した(ck_genres_budget)';
  end;

  -- 支出目標の期間が逆転している
  begin
    insert into public.spending_plans (user_id, period_start, period_end)
    values (u, '2026-10-31', '2026-10-01');
    raise exception 'FAIL: 終了日が開始日より前の目標が通ってしまった';
  exception when check_violation then
    raise notice 'OK: 期間が逆転した目標を拒否した(ck_spending_plans_period)';
  end;

  -- 支出目標にマイナスの目標額
  begin
    insert into public.spending_plans (id, user_id, period_start, period_end)
    values ('eeeeeeee-0000-0000-0000-000000000001', u, '2026-10-01', '2026-10-31');
    insert into public.spending_plan_items (plan_id, user_id, genre_id, target_yen)
    values ('eeeeeeee-0000-0000-0000-000000000001', u,
            (select id from public.genres where user_id = u and name = '食料品'), -1);
    raise exception 'FAIL: マイナスの目標額が通ってしまった';
  exception when check_violation then
    raise notice 'OK: マイナスの目標額を拒否した(ck_spending_plan_items_target)';
  end;

end $$;

-- FR-14 の予算消化状況(残額・使用率)は SQL ビューではなく domain/budget.ts が
-- 計算する(ADR-057 で v_current_month_budget_status を廃止した際の判断、
-- docs/schema.sql 参照)。ここでは genres.budget_yen と genre_id 紐付けの
-- データモデルが機能することだけを素のSQLで疎通確認する。
\echo '--- FR-14: ジャンル予算とジャンル別支出の疎通確認 ---'
update public.genres set budget_yen = 40000
where user_id = '11111111-1111-1111-1111-111111111111' and name = '娯楽・趣味';

insert into public.transactions (user_id, account_id, occurred_on, amount_yen, description,
                                 source, genre_id, classified_by, confidence, review_status)
select '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
       public.month_start_jst() + 5, -30000, '映画館', 'csv',
       id, 'ai', 0.910, 'auto_ok'
from public.genres
where user_id = '11111111-1111-1111-1111-111111111111' and name = '娯楽・趣味';

select g.name, g.budget_yen, sum(-t.amount_yen) as spent_yen,
       g.budget_yen - sum(-t.amount_yen) as remaining_yen
from public.genres g
join public.transactions t
  on t.genre_id = g.id and t.occurred_on >= public.month_start_jst()
where g.user_id = '11111111-1111-1111-1111-111111111111'
group by g.name, g.budget_yen;

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
select count(*) as goals_visible_to_other_user,
       (select count(*) from public.transactions) as tx_visible_to_other_user
from public.goals;

set local "test.user_id" = '11111111-1111-1111-1111-111111111111';
select count(*) as goals_visible_to_owner,
       (select count(*) from public.transactions) as tx_visible_to_owner
from public.goals;
commit;

\echo '--- 全テーブルで RLS が有効か(tables_without_rls は 0 であること)---'
select count(*) filter (where not c.relrowsecurity) as tables_without_rls,
       count(*)                                     as total_tables
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r';
