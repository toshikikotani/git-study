-- =============================================================================
--  定期ジョブ(pg_cron)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260908000900_cron.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- =============================================================================
--  9. 定期ジョブ(pg_cron)
--
--   ADR-009:外部 API を呼ぶ業務ジョブは GitHub Actions に置く。
--   ここに置くのは「DB 自身が自分を生かす」死活経路のみ(NFR-05)。
--   GitHub Actions 側が止まっても、この1本だけは動き続ける。
-- =============================================================================

-- 毎日 03:15 JST(= 18:15 UTC)に軽量な書き込みを行い、無料枠の自動停止を回避する
select cron.schedule(
  'keepalive-touch',
  '15 18 * * *',
  $cron$
    insert into public.job_runs (user_id, job_name, status, trigger_source,
                                 finished_at, duration_ms, items_processed)
    select u.id, 'keepalive', 'succeeded', 'pg_cron', now(), 0, 1
    from auth.users u;

    delete from public.job_runs
    where job_name = 'keepalive'
      and started_at < now() - interval '90 days';
  $cron$
);

commit;
