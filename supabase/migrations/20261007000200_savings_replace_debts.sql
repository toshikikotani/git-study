-- =============================================================================
--  借金をやめ、貯金(貯金目標)に変える(本人の選択、ADR-081)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20261007000200_savings_replace_debts.sql は実際に適用される正。
--
--  - 借金の記録は消す(本人の選択:記録ごと完全に消す)。debts・debt_payments・
--    repayment_scenarios と、借金の計算の関数・ビューを削除する。戻せない。
--  - 貯金目標は goals を使う。貯まった額は「収入 − 支出」から自動で数えるので、
--    数え始める日(start_on)を足す。既存の目標は作った日から数える。
--  - 設定の「月々の返済目標」は「毎月の貯金目標」に、投資・副業の比率も貯金を基準にする。
--  - 純資産の記録は「残債」ではなく「貯金」を持つ(過去の行の貯金は0。残債の値は消す)。
--  - 口座の用途 'repayment' は、値はそのまま「貯金」として使う(画面の名前だけ変える。
--    列挙の値を足すと、同じトランザクションの中で使えないため)。
-- =============================================================================

begin;

-- 1. 借金を参照する列を外す
alter table public.transfer_rules drop column if exists debt_id;
alter table public.alerts drop column if exists debt_id;

-- 2. 借金の計算の関数・ビュー・表・型を消す
drop view if exists public.v_debt_overview;
drop function if exists public.simulate_total_payoff(uuid, bigint, repayment_strategy, integer);
drop function if exists public.simulate_debt_payoff(uuid, bigint, integer);
drop table if exists public.debt_payments;
drop table if exists public.repayment_scenarios;
drop table if exists public.debts;
drop type if exists debt_status;
drop type if exists debt_kind;

-- 3. 設定:返済 → 貯金
alter table public.app_settings drop column if exists repayment_strategy;
drop type if exists repayment_strategy;
alter table public.app_settings rename column monthly_repayment_target_yen to monthly_savings_target_yen;
alter table public.app_settings rename column investment_ratio_of_repayment to investment_ratio_of_savings;
alter table public.app_settings rename column side_income_repayment_ratio to side_income_savings_ratio;
alter table public.app_settings
  drop constraint if exists ck_app_settings_ratios,
  drop constraint if exists ck_app_settings_amounts;
alter table public.app_settings
  add constraint ck_app_settings_ratios
    check (investment_ratio_of_savings between 0 and 1
       and side_income_savings_ratio   between 0 and 1
       and high_risk_allocation_ratio  between 0 and 1
       and waste_alert_threshold       between 0 and 1
       and classification_confidence_threshold between 0 and 1),
  add constraint ck_app_settings_amounts
    check (monthly_take_home_yen      >= 0
       and monthly_savings_target_yen >= 0);
comment on column public.app_settings.is_high_risk_unlocked is
  '高リスク投資の枠を使うか(本人が設定で切り替える)。以前は全負債の完済で自動で解禁していた。';

-- 4. 貯金目標:数え始める日
alter table public.goals add column if not exists start_on date;
update public.goals set start_on = (created_at at time zone 'Asia/Tokyo')::date where start_on is null;
alter table public.goals
  alter column start_on set default public.today_jst(),
  alter column start_on set not null;

-- 5. 純資産の記録:残債 → 貯金
alter table public.net_worth_snapshots drop constraint if exists ck_net_worth_debt_balance;
alter table public.net_worth_snapshots drop column if exists debt_balance_yen;
alter table public.net_worth_snapshots add column if not exists savings_yen bigint not null default 0;
alter table public.net_worth_snapshots
  add constraint ck_net_worth_savings check (savings_yen >= 0);

-- 5a. 副業の振り分け:返済 → 貯金
alter table public.side_incomes rename column allocated_to_repayment_yen to allocated_to_savings_yen;

-- 5b. 朝のブリーフの「完済まで」「残債」のスナップショットを消す
alter table public.daily_briefs drop column if exists days_to_payoff;
alter table public.daily_briefs drop column if exists remaining_debt_yen;

-- 6. 給料日の振替ルール「返済へ」を「貯金へ」に(同じ名前が無いときだけ)
update public.transfer_rules t
set name = '貯金へ'
where t.name = '返済へ'
  and not exists (
    select 1 from public.transfer_rules o where o.user_id = t.user_id and o.name = '貯金へ'
  );

-- 7. seed_defaults():借金・返済シナリオを入れない。振替は「貯金へ」から
create or replace function public.seed_defaults(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.app_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- ジャンル(ADR-057)。features/genre/store.ts の DEFAULT_GENRE_NAMES と同じ一覧。
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

  -- FR-15:給料日振替の既定順序(貯金 → 投資 → 聖域 → 生活費)。金額は本人が調整する。
  insert into public.transfer_rules
    (user_id, name, trigger, execution_order, amount_type, amount_yen, genre_id)
  values
    (p_user_id, '貯金へ',       'payday', 1, 'fixed',      30000, null),
    (p_user_id, '投資へ',       'payday', 2, 'fixed',      10000, null),
    (p_user_id, '聖域枠へ',     'payday', 3, 'fixed',      40000, null),
    (p_user_id, '生活費へ',     'payday', 4, 'remainder',   null, null)
  on conflict (user_id, name) do nothing;
end;
$$;

comment on function public.seed_defaults(uuid) is
  'ジャンル・振替ルールの初期値を投入する。ユーザー作成直後に一度だけ実行する。';

commit;
