-- =============================================================================
--  読み取りに失敗したレシートの手動入力(F7)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000300_receipt_captures.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--
--  - receipt_captures: 撮影したレシートの「入力待ち」の記録。明細(transactions)とは別に持つため、
--    入力が終わるまで家計簿の集計・目標には一切入らない。元の画像とAIの生の読み取り結果は
--    破棄しても消さない(status='discarded' にするだけ)。
-- =============================================================================

begin;

create table public.receipt_captures (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,

  -- needs_input: 手で入力する必要がある(明細・要確認に「入力待ち」と出る)
  -- resolved   : 明細として保存済み(transaction_id が入る)
  -- discarded  : 破棄した(Undo できるよう行は消さず、画像も残す)
  status            text        not null default 'needs_input',
  -- 読み取りの結果: parsed(全部読めた)/ partial(一部だけ)/ failed(読めない)/ manual(最初から手入力)
  receipt_status    text        not null default 'failed',

  -- 元の画像は消さない。補正(切り抜き・回転・明るさ)した画像は別のパスで持つ。
  image_path        text        not null,
  edited_image_path text,

  -- AI の生の読み取り結果(warnings・部分的に読めた値)。再読み取りの比較に使う。
  ocr_raw           jsonb,
  -- 読み取れた項目({amountYen, occurredOn, storeName, ...})と読めなかった項目の名前。
  read_fields       jsonb       not null default '{}'::jsonb,
  unread_fields     text[]      not null default '{}',
  -- 入力途中の内容(下書き)。離れても消えない。
  draft             jsonb,
  draft_updated_at  timestamptz,

  transaction_id    uuid        references public.transactions(id) on delete set null,
  captured_on       date        not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  discarded_at      timestamptz,

  constraint ck_receipt_captures_status
    check (status in ('needs_input', 'resolved', 'discarded')),
  constraint ck_receipt_captures_receipt_status
    check (receipt_status in ('parsed', 'partial', 'failed', 'manual'))
);

create index ix_receipt_captures_user_status
  on public.receipt_captures (user_id, status, created_at desc);

alter table public.receipt_captures enable row level security;
alter table public.receipt_captures force row level security;

drop policy if exists "own_rows" on public.receipt_captures;
create policy "own_rows" on public.receipt_captures
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
