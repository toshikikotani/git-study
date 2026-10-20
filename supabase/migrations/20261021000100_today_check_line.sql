begin;

-- 夜の答え合わせ(LINE、v4-2、ADR-130)。送る時刻とオン・オフを設定で変えられるようにする。
alter table public.app_settings
  add column if not exists evening_check_enabled boolean not null default true;
alter table public.app_settings
  add column if not exists evening_check_at time not null default '21:00';

-- 同じ支払いを1件にまとめた記録(v4 の共通の土台1、ADR-129)。レシート(品目あり)とカードの通知メールが
-- 同じ日・同じ金額・そろえた店名で重なったら、支払いの方を残して品目と画像を移す。「分ける」で元に戻す
-- ための、移す前の状態を持つ。
create table if not exists public.payment_merges (
  user_id               uuid        not null references auth.users(id) on delete cascade,
  kept_transaction_id   uuid        not null references public.transactions(id) on delete cascade,
  merged_transaction_id uuid        not null references public.transactions(id) on delete cascade,
  kept_before           jsonb       not null default '{}'::jsonb,
  merged_before         jsonb       not null default '{}'::jsonb,
  moved_item_ids        uuid[]      not null default '{}',
  moved_split_ids       uuid[]      not null default '{}',
  merged_at             timestamptz not null default now(),
  primary key (user_id, merged_transaction_id),
  constraint ck_payment_merges_distinct check (kept_transaction_id <> merged_transaction_id)
);

create index if not exists ix_payment_merges_kept on public.payment_merges (kept_transaction_id);

alter table public.payment_merges enable row level security;
alter table public.payment_merges force row level security;

drop policy if exists "own_rows" on public.payment_merges;
create policy "own_rows" on public.payment_merges
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = kept_transaction_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = merged_transaction_id and t.user_id = (select auth.uid())
    )
  );

commit;
