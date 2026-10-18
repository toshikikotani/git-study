begin;

-- 割り勘の依頼時点の内容と受取人数。元の明細・収支は変更しない。
create table if not exists public.split_payment_requests (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  signature             text        not null,
  entries               jsonb       not null,
  participants          bigint      not null,
  total_yen             bigint      not null,
  amount_per_person_yen bigint      not null,
  received_count        bigint      not null default 0,
  version               bigint      not null default 0,
  created_at            timestamptz not null default now(),
  constraint ux_split_payment_requests_user_signature unique (user_id, signature),
  constraint ck_split_payment_requests_signature
    check (signature ~ '^[0-9a-f]{64}$'),
  constraint ck_split_payment_requests_entries
    check (case when jsonb_typeof(entries) = 'array' then jsonb_array_length(entries) >= 1 else false end),
  constraint ck_split_payment_requests_participants
    check (participants between 2 and 1000000000000),
  constraint ck_split_payment_requests_total
    check (total_yen between 1 and 1000000000000),
  constraint ck_split_payment_requests_amount
    check (amount_per_person_yen between 1 and 1000000000000
      and amount_per_person_yen = total_yen / nullif(participants, 0)),
  constraint ck_split_payment_requests_received
    check (received_count between 0 and participants - 1),
  constraint ck_split_payment_requests_version check (version >= 0)
);

create index if not exists ix_split_payment_requests_user_created
  on public.split_payment_requests (user_id, created_at desc);

alter table public.split_payment_requests enable row level security;
alter table public.split_payment_requests force row level security;

drop policy if exists "own_rows" on public.split_payment_requests;
create policy "own_rows" on public.split_payment_requests
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
