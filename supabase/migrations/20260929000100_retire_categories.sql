-- =============================================================================
--  categories・classification_rules・budgets の廃止、genres への一本化
--  (本人発案、ADR-057)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260929000100_retire_categories.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
--
--  背景(ADR-057参照):本人発案「今までの生活費・無駄金・浪費など、ユーザー
--  定義のカテゴリ分けの概念を完全に廃止したい。そして今のカテゴリ(ジャンル)
--  を正とする」。返済・投資・収入・口座間振替も含め、全ての明細をジャンルで
--  扱う(「収入と支出という概念では同じ」という本人の判断)。分類ルール
--  (パターンでカテゴリを決める仕組み)も、本人が「このパターンはこのカテゴリ」
--  と決める主観であるため廃止する。リボ払い等の危険検知(FR-21)は
--  `DEFAULT_DETECTION_RULES`(features/classification/rules.ts)としてTS側に
--  固定済みで、そもそもDBに保存されていなかったため、この廃止の影響を受けない。
--  budgets テーブルは、コードのどこからも書き込みが無い死んだ仕組みだったため
--  (月次上書き・繰越は使われていなかった)、genres.budget_yen という単一の
--  値へ統合して廃止する。
-- =============================================================================

begin;

-- 1. categories/budgets に依存するビューを先に落とす(アプリのどこからも
--    実際には問い合わせていないドキュメント用のビューだった)。
--    transactions.category_id を落とす前に、それに依存するこのビューを
--    先に落とす必要がある(依存関係の都合で順序が固定)。
-- -----------------------------------------------------------------------------
drop view if exists public.v_current_month_budget_status;
drop view if exists public.v_monthly_category_spend;

-- 2. transactions:category_id → genre_id、matched_rule_id を廃止、must_pay を追加
-- -----------------------------------------------------------------------------
alter table public.transactions
  drop constraint if exists ck_transactions_classified_has_category;

alter table public.transactions
  drop constraint if exists fk_transactions_matched_rule;

drop index if exists public.ix_transactions_matched_rule;
drop index if exists public.ix_transactions_user_category_occurred;

alter table public.transactions
  drop column if exists matched_rule_id,
  drop column if exists category_id,
  add column genre_id uuid references public.genres(id) on delete set null,
  -- 本人発案「絶対払わざるを得ないもの」に明細1件ごとに付けるラベル
  -- (ジャンルとは独立した軸。ADR-057)。
  add column must_pay boolean not null default false;

alter table public.transactions
  add constraint ck_transactions_classified_has_genre
    check (classified_by = 'unclassified' or genre_id is not null);

create index ix_transactions_user_genre_occurred
  on public.transactions (user_id, genre_id, occurred_on desc);

-- 3. transfer_rules・transaction_splits・receipt_items・alerts:category_id → genre_id
-- -----------------------------------------------------------------------------
alter table public.transfer_rules
  drop column if exists category_id,
  add column genre_id uuid references public.genres(id) on delete set null;

alter table public.transaction_splits
  drop column if exists category_id,
  add column genre_id uuid references public.genres(id) on delete set null;

alter table public.receipt_items
  drop column if exists category_id,
  add column genre_id uuid references public.genres(id) on delete set null;

alter table public.alerts
  drop column if exists category_id,
  add column genre_id uuid references public.genres(id) on delete set null;

-- 4. budgets — genres.budget_yen に統合するため廃止(書き込みコードが無かった)
-- -----------------------------------------------------------------------------
drop table if exists public.budgets;

-- 5. classification_rules — パターンによる主観的な分類を廃止
-- -----------------------------------------------------------------------------
drop table if exists public.classification_rules;

-- 6. categories・category_kind — genres に一本化するため廃止
-- -----------------------------------------------------------------------------
drop table if exists public.categories;
drop type if exists category_kind;

-- 7. seed_defaults() — カテゴリ・分類ルールの投入をやめ、ジャンルを投入する
-- -----------------------------------------------------------------------------
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
