-- =============================================================================
--  rescued_emails — AI救済メールの保存(T-11)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908001200_rescued_emails.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 3.21 rescued_emails — AI救済メールの保存(T-11)
-- -----------------------------------------------------------------------------
-- ラベル辞書(email.ts の LABELS)で読めず AI に回ったメールの本文を残す。
-- 辞書に語を足せば同じ書式は次から費用ゼロの経路に戻せるが、それには
-- 「どんな書式で落ちたか」を後から見返せる必要がある(ADR-019)。
create table public.rescued_emails (
  id              uuid               primary key default gen_random_uuid(),
  user_id         uuid               not null references auth.users(id) on delete cascade,

  source          transaction_source not null,
  subject         text,
  body            text               not null,
  extracted_count smallint           not null default 0,

  created_at      timestamptz        not null default now(),

  constraint ck_rescued_emails_extracted_count check (extracted_count >= 0)
);

create index ix_rescued_emails_user_created on public.rescued_emails (user_id, created_at desc);

commit;
