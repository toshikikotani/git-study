-- =============================================================================
--  app_settings.google_backup_spreadsheet_id — バックアップ先の参照(本人発案)
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260913000500_app_settings_google_backup.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--  両者の乖離は scripts/verify-migrations.sh と CI が検出する。
-- =============================================================================

begin;

-- 月次バックアップ(Googleスプレッドシート)の書き込み先。初回のバックアップ時に
-- アプリが自動でスプレッドシートを作成し、その id をここへ記録する(以降は
-- 同じシートへ書き続ける)。値そのものは秘密情報ではない(参照名、ADR-014)ため
-- app_settings に置く。実際の認証情報(GOOGLE_REFRESH_TOKEN 等)は環境変数のみ。
alter table public.app_settings
  add column google_backup_spreadsheet_id text;

commit;
