-- AIの補正パーセントの範囲を広げる(-30〜50)
alter table ai_forecast_reads drop constraint ck_ai_forecast_reads_percent;
alter table ai_forecast_reads add constraint ck_ai_forecast_reads_percent check (ai_percent between -30 and 50);
