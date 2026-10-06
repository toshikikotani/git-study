-- もう使わないカテゴリは、残りの日の予測に足さない。
alter table genres
  add column if not exists forecast_closed boolean not null default false;
