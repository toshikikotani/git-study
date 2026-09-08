-- Supabase 環境の最小スタブ。schema.sql を素の PostgreSQL で検証するためのもの。
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists cron;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- 検証中は current_setting でユーザーを差し替えられるようにする
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.user_id', true), '')::uuid;
$$;

-- pg_cron はローカルに無いので schedule() だけを模す
create or replace function cron.schedule(text, text, text) returns bigint
language sql as $$ select 1::bigint $$;
