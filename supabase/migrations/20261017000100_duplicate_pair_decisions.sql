begin;

-- 重複確認:「別の買い物」という判断は明細単位でなく本人のペア単位で保存する。
create table if not exists public.duplicate_pair_decisions (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  transaction_a_id uuid        not null references public.transactions(id) on delete cascade,
  transaction_b_id uuid        not null references public.transactions(id) on delete cascade,
  signature        text        not null,
  decided_at       timestamptz not null default now(),
  primary key (user_id, transaction_a_id, transaction_b_id),
  constraint ck_duplicate_pair_order check (transaction_a_id < transaction_b_id)
);

create index if not exists ix_duplicate_pair_a on public.duplicate_pair_decisions (transaction_a_id);
create index if not exists ix_duplicate_pair_b on public.duplicate_pair_decisions (transaction_b_id);

alter table public.duplicate_pair_decisions enable row level security;
alter table public.duplicate_pair_decisions force row level security;

drop policy if exists "own_rows" on public.duplicate_pair_decisions;
create policy "own_rows" on public.duplicate_pair_decisions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_a_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_b_id and t.user_id = (select auth.uid())
    )
  );

-- 金額・日付・経路を編集したら、元の内容に戻しても古い判断を復活させない。
create or replace function public.invalidate_duplicate_pair_decisions()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from public.duplicate_pair_decisions
  where user_id = new.user_id
    and (transaction_a_id = new.id or transaction_b_id = new.id);
  return new;
end;
$$;

drop trigger if exists invalidate_duplicate_pair_decisions on public.transactions;
create trigger invalidate_duplicate_pair_decisions
  after update of occurred_on, amount_yen, source on public.transactions
  for each row
  when (old.occurred_on is distinct from new.occurred_on
    or old.amount_yen is distinct from new.amount_yen
    or old.source is distinct from new.source)
  execute function public.invalidate_duplicate_pair_decisions();

commit;
