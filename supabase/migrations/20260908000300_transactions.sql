-- =============================================================================
--  取引明細と重複排除
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000300_transactions.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.8 transactions — 取引明細(FR-10〜FR-14)
--
--   本システムで最も行数が増えるテーブル。索引設計はここが要。
--   ADR-008: amount_yen は符号付き(支出が負、収入が正)
-- -----------------------------------------------------------------------------
create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid               not null references auth.users(id) on delete cascade,
  account_id        uuid               not null references public.accounts(id) on delete restrict,

  occurred_on       date               not null,   -- 利用日
  posted_on         date,                          -- 計上日(カードの請求確定日)

  amount_yen        bigint             not null,   -- 支出が負、収入が正
  is_expense        boolean            generated always as (amount_yen < 0) stored,

  description       text               not null,   -- 摘要(生データ)
  merchant_name     text,                          -- 正規化した店名

  -- 取り込み情報
  source            transaction_source not null,
  source_ref        text,                          -- Gmail の message-id など外部一意キー
  import_batch_id   uuid               references public.import_batches(id) on delete set null,
  raw               jsonb,                         -- 元データ全体を保持(再解析用)

  -- 重複排除キー。トリガで自動生成する(ADR-007)
  fingerprint       text               not null,

  -- 分類(FR-11, FR-12)
  category_id       uuid               references public.categories(id) on delete set null,
  classified_by     classified_by      not null default 'unclassified',
  confidence        numeric(4,3),
  matched_rule_id   uuid,                          -- FK は classification_rules 定義後に追加
  review_status     review_status      not null default 'pending',
  reviewed_at       timestamptz,

  -- FR-21 の判定対象。AI ではなく決定的なルールで埋める(ADR-010)
  payment_method    payment_method     not null default 'unknown',

  -- 口座間振替は収支に計上しない
  is_transfer       boolean            not null default false,
  counter_transaction_id uuid          references public.transactions(id) on delete set null,

  note              text,
  created_at        timestamptz        not null default now(),
  updated_at        timestamptz        not null default now(),

  -- 0円明細は取り込みミス
  constraint ck_transactions_amount_nonzero check (amount_yen <> 0),
  constraint ck_transactions_description    check (btrim(description) <> ''),
  constraint ck_transactions_confidence     check (confidence is null
                                                   or confidence between 0 and 1),
  -- AI が分類したなら確信度が必ずある。無いまま閾値判定に流れる事故を防ぐ
  constraint ck_transactions_ai_needs_confidence
    check (classified_by <> 'ai' or confidence is not null),
  -- 分類済みならカテゴリがある
  constraint ck_transactions_classified_has_category
    check (classified_by = 'unclassified' or category_id is not null),
  -- 本人が確認・修正したなら日時が残る(学習データの根拠)
  constraint ck_transactions_reviewed_at
    check (review_status not in ('confirmed','corrected') or reviewed_at is not null),
  constraint ck_transactions_not_self_counter
    check (counter_transaction_id is null or counter_transaction_id <> id),
  constraint ck_transactions_posted_after_occurred
    check (posted_on is null or posted_on >= occurred_on)
);

-- 重複排除:同一ファイルを別名で取り込んでも同じ明細は入らない
create unique index ux_transactions_fingerprint
  on public.transactions (user_id, fingerprint);

-- Gmail の message-id など、外部の一意キーがある場合の重複排除
create unique index ux_transactions_source_ref
  on public.transactions (user_id, source, source_ref)
  where source_ref is not null;

-- 一覧・月次集計の主経路
create index ix_transactions_user_occurred
  on public.transactions (user_id, occurred_on desc);
create index ix_transactions_user_category_occurred
  on public.transactions (user_id, category_id, occurred_on desc);
create index ix_transactions_account_occurred
  on public.transactions (account_id, occurred_on desc);

-- FR-12:本人確認待ちの明細だけを引く。部分索引で小さく保つ
create index ix_transactions_pending_review
  on public.transactions (user_id, occurred_on desc)
  where review_status = 'pending';

-- FR-21:リボ・キャッシング・分割の検知。ここは即時性が要るので専用の部分索引
create index ix_transactions_risky_payment
  on public.transactions (user_id, occurred_on desc)
  where payment_method in ('revolving', 'cashing', 'installment');

-- 未分類の掃き出し
create index ix_transactions_unclassified
  on public.transactions (user_id, occurred_on desc)
  where classified_by = 'unclassified';

-- 摘要の全文検索(明細を探す用途)
create index ix_transactions_description_trgm
  on public.transactions using gin (description extensions.gin_trgm_ops);

comment on column public.transactions.amount_yen is
  '符号付きの円。支出が負、収入が正。SUM() だけで収支が出る。集計時に CASE を書かせない(ADR-008)。';
comment on column public.transactions.classified_by is
  '「カテゴリを誰が決めたか」を表す。支払方法だけを設定するルール(リボ検知など)は
   カテゴリを付けないため、この列を変更しない。unclassified 以外はカテゴリ必須。';
comment on column public.transactions.fingerprint is
  '口座・日付・金額・正規化した摘要から生成する重複排除キー。トリガ trg_transactions_fingerprint が自動設定する。';


-- 重複排除キーの自動生成
create or replace function public.set_transaction_fingerprint()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fingerprint := md5(
    coalesce(new.account_id::text, '')                                   || '|' ||
    to_char(new.occurred_on, 'YYYYMMDD')                                 || '|' ||
    new.amount_yen::text                                                 || '|' ||
    lower(regexp_replace(coalesce(new.description, ''), '[[:space:]]', '', 'g'))
  );
  return new;
end;
$$;

create trigger trg_transactions_fingerprint
  before insert or update of account_id, occurred_on, amount_yen, description
  on public.transactions
  for each row execute function public.set_transaction_fingerprint();


-- -----------------------------------------------------------------------------

commit;
