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

\echo '--- 重複ペア判断: 本人のペアだけ保存・取消、内容変更時に無効化 ---'
insert into public.accounts (id, user_id, name, kind, purpose)
values ('aaaaaaaa-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', '他人の銀行', 'bank', 'salary');
insert into public.transactions (id, user_id, account_id, occurred_on, amount_yen, description, source)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-15', -1200, 'ペア確認A', 'manual'),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-15', -1200, 'ペア確認B', 'gmail'),
  ('dddddddd-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', '2026-10-15', -1200, '他人の明細', 'csv');

begin;
set local role authenticated;
set local "test.user_id" = '11111111-1111-1111-1111-111111111111';
insert into public.duplicate_pair_decisions (user_id, transaction_a_id, transaction_b_id, signature)
values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'original');

do $$
begin
  if (select count(*) from public.duplicate_pair_decisions) <> 1 then
    raise exception 'FAIL: 本人のペア判断を保存できない';
  end if;
  begin
    insert into public.duplicate_pair_decisions (user_id, transaction_a_id, transaction_b_id, signature)
    values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'reversed');
    raise exception 'FAIL: 逆順のペアを重複保存できてしまった';
  exception when check_violation then null;
  end;
end $$;

set local "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
begin
  if exists (select 1 from public.duplicate_pair_decisions) then
    raise exception 'FAIL: 他人の判断が見えている';
  end if;
  begin
    insert into public.duplicate_pair_decisions (user_id, transaction_a_id, transaction_b_id, signature)
    values ('22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000003', 'foreign-pair');
    raise exception 'FAIL: 本人名義でも他人の明細をペアへ保存できてしまった';
  exception when insufficient_privilege then null;
  end;
  delete from public.duplicate_pair_decisions;
end $$;

set local "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
begin
  if (select count(*) from public.duplicate_pair_decisions) <> 1 then
    raise exception 'FAIL: 他人が判断を消せてしまった';
  end if;
  delete from public.duplicate_pair_decisions;
  if exists (select 1 from public.duplicate_pair_decisions) then
    raise exception 'FAIL: 本人が判断を取り消せない';
  end if;
  insert into public.duplicate_pair_decisions (user_id, transaction_a_id, transaction_b_id, signature)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'reopened');
  update public.transactions set amount_yen = -1200 where id = 'dddddddd-0000-0000-0000-000000000001';
  if (select count(*) from public.duplicate_pair_decisions) <> 1 then
    raise exception 'FAIL: 内容が変わらない更新で判断が失われた';
  end if;
  update public.transactions set occurred_on = '2026-10-16' where id = 'dddddddd-0000-0000-0000-000000000001';
  if exists (select 1 from public.duplicate_pair_decisions) then
    raise exception 'FAIL: 日付変更後も判断が残った';
  end if;
  insert into public.duplicate_pair_decisions (user_id, transaction_a_id, transaction_b_id, signature)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'new-date');
  update public.transactions set amount_yen = -1300 where id = 'dddddddd-0000-0000-0000-000000000002';
  if exists (select 1 from public.duplicate_pair_decisions) then
    raise exception 'FAIL: 金額変更後も判断が残った';
  end if;
  insert into public.duplicate_pair_decisions (user_id, transaction_a_id, transaction_b_id, signature)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'new-amount');
  delete from public.transactions where id = 'dddddddd-0000-0000-0000-000000000002';
  if exists (select 1 from public.duplicate_pair_decisions) then
    raise exception 'FAIL: 明細削除後もペア判断が残った';
  end if;
end $$;
commit;

\echo '--- 割り勘の受取: 本人だけが作成・更新・取消でき、不正な金額・人数を保存できない ---'
begin;
set local role authenticated;
set local "test.user_id" = '11111111-1111-1111-1111-111111111111';
insert into public.split_payment_requests (
  id, user_id, signature, entries, participants, total_yen, amount_per_person_yen
) values (
  'eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  repeat('a', 64), '[{"label":"食事","amountYen":-1000}]', 3, 1000, 333
);

do $$
declare
  invalid_patch text;
  changed bigint;
begin
  if (select count(*) from public.split_payment_requests) <> 1 then
    raise exception 'FAIL: 本人の割り勘依頼を保存・参照できない';
  end if;
  if not exists (
    select 1 from public.split_payment_requests
    where received_count = 0 and version = 0 and created_at is not null
  ) then
    raise exception 'FAIL: 受取人数・バージョン・作成日時の既定値が正しくない';
  end if;
  begin
    insert into public.split_payment_requests (
      user_id, signature, entries, participants, total_yen, amount_per_person_yen
    ) values ('11111111-1111-1111-1111-111111111111', repeat('a', 64), '[{}]', 3, 1000, 333);
    raise exception 'FAIL: 同じ本人・署名の依頼を重複保存できてしまった';
  exception when unique_violation then null;
  end;
  foreach invalid_patch in array array[
    'received_count = -1', 'received_count = 3',
    'participants = 0', 'participants = 1', 'participants = 1000000000001',
    'total_yen = 0', 'total_yen = 1000000000001',
    'amount_per_person_yen = 0', 'amount_per_person_yen = 334',
    'amount_per_person_yen = 1000000000001', 'version = -1',
    'entries = ''[]''::jsonb', 'entries = ''{}''::jsonb',
    'signature = ''invalid'''
  ] loop
    begin
      execute format(
        'update public.split_payment_requests set %s where id = %L::uuid',
        invalid_patch, 'eeeeeeee-0000-0000-0000-000000000001'
      );
      raise exception 'FAIL: 不正な割り勘依頼の更新が成功した: %', invalid_patch;
    exception when check_violation then null;
    end;
  end loop;
  update public.split_payment_requests set received_count = 1, version = 1
  where id = 'eeeeeeee-0000-0000-0000-000000000001' and version = 0;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'FAIL: 本人が受取を記録できない';
  end if;
  update public.split_payment_requests set received_count = 2, version = 1
  where id = 'eeeeeeee-0000-0000-0000-000000000001' and version = 0;
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: 古いバージョンの更新が受取を上書きした';
  end if;
  update public.split_payment_requests set received_count = 2, version = 2
  where id = 'eeeeeeee-0000-0000-0000-000000000001' and version = 1;
  if not exists (select 1 from public.split_payment_requests where received_count = 2 and version = 2) then
    raise exception 'FAIL: 全員の受取を記録できない';
  end if;
  update public.split_payment_requests set received_count = 0, version = 3
  where id = 'eeeeeeee-0000-0000-0000-000000000001' and version = 2;
  if not exists (select 1 from public.split_payment_requests where received_count = 0 and version = 3) then
    raise exception 'FAIL: 受取チェックを元に戻せない';
  end if;
  begin
    update public.split_payment_requests set user_id = '22222222-2222-2222-2222-222222222222'
    where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'FAIL: 他人名義へ依頼を変更できてしまった';
  exception when insufficient_privilege then null;
  end;
end $$;

set local "test.user_id" = '22222222-2222-2222-2222-222222222222';
do $$
declare
  changed bigint;
begin
  if exists (select 1 from public.split_payment_requests) then
    raise exception 'FAIL: 他人の割り勘依頼が見えている';
  end if;
  update public.split_payment_requests set received_count = 1
  where id = 'eeeeeeee-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: 他人が受取を更新できてしまった';
  end if;
  delete from public.split_payment_requests where id = 'eeeeeeee-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: 他人が割り勘依頼を削除できてしまった';
  end if;
  begin
    insert into public.split_payment_requests (
      user_id, signature, entries, participants, total_yen, amount_per_person_yen
    ) values ('11111111-1111-1111-1111-111111111111', repeat('b', 64), '[{}]', 3, 1000, 333);
    raise exception 'FAIL: 他人名義の割り勘依頼を作れてしまった';
  exception when insufficient_privilege then null;
  end;
  -- 同じ署名でも、別ユーザーの依頼は独立する。
  insert into public.split_payment_requests (
    user_id, signature, entries, participants, total_yen, amount_per_person_yen
  ) values ('22222222-2222-2222-2222-222222222222', repeat('a', 64), '[{}]', 3, 1000, 333);
  delete from public.split_payment_requests;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'FAIL: 別ユーザーが自分の依頼だけを取り消せない';
  end if;
end $$;

set local "test.user_id" = '11111111-1111-1111-1111-111111111111';
do $$
begin
  if (select count(*) from public.split_payment_requests) <> 1 then
    raise exception 'FAIL: 他人の削除操作で本人の割り勘依頼が失われた';
  end if;
  delete from public.split_payment_requests;
  if exists (select 1 from public.split_payment_requests) then
    raise exception 'FAIL: 本人が割り勘依頼を取り消せない';
  end if;
end $$;
commit;

\echo '--- 全テーブルで RLS が有効か(tables_without_rls は 0 であること)---'
select count(*) filter (where not c.relrowsecurity) as tables_without_rls,
       count(*)                                     as total_tables
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r';
