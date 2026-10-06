-- =============================================================================
--  spending_promises — ジャンルの約束(「外食を週1回へらす」、ADR-075)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20261006000300_spending_promises.sql は実際に適用される正。
-- =============================================================================

begin;

-- ジャンル画面の「決める」で、月ごと・ジャンルごとに1行。決めた回数は予測に入り、
-- 月が終わったら、使った額が「約束どおりの見込み」に収まったか(守れたか)を見せる。
create table public.spending_promises (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  genre_id    uuid        not null references public.genres(id) on delete cascade,
  month       date        not null,
  per_week    smallint    not null,
  promised_on date        not null,
  usual_yen   integer     not null,
  limit_yen   integer     not null,
  created_at  timestamptz not null default now(),

  constraint uq_spending_promises_genre_month unique (user_id, genre_id, month),
  constraint ck_spending_promises_month check (extract(day from month) = 1),
  constraint ck_spending_promises_per_week check (per_week between 1 and 7),
  constraint ck_spending_promises_yen check (usual_yen >= 0 and limit_yen >= 0)
);

commit;
