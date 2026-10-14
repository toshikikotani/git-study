-- AIの補正パーセントの範囲を広げる(-30〜50)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'ai_forecast_reads') then
    alter table ai_forecast_reads drop constraint if exists ck_ai_forecast_reads_percent;
    alter table ai_forecast_reads add constraint ck_ai_forecast_reads_percent check (ai_percent between -30 and 50);
  end if;
end $$;
