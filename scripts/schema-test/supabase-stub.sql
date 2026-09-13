-- Supabase 環境の最小スタブ。schema.sql を素の PostgreSQL で検証するためのもの。
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists cron;
create schema if not exists storage;

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

-- Supabase Storage の最小スタブ(receipts バケットの RLS 検証用)。
-- 列は本物の一部だけ(RLS のポリシーが参照する分)。
create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text,
  owner     uuid
);

-- 本物の storage.foldername() と同じ形("a/b/c.jpg" → {a,b})。
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select case
    when array_length(string_to_array(name, '/'), 1) <= 1 then array[]::text[]
    else (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
  end;
$$;
