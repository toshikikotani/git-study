#!/usr/bin/env bash
#
# supabase/migrations/ と docs/schema.sql が同じスキーマを作ることを検証する。
#
# 本プロジェクトは2つの正を持つ:
#   docs/schema.sql        人間が全体像を読むための正
#   supabase/migrations/   実際に適用される正
#
# 片方だけを更新すると、レビューでは気づかないまま本番と設計書がずれる。
# ここでは両方をまっさらな PostgreSQL に適用し、スキーマダンプを比較する。
# 差分が出たら、どちらかの更新が漏れているということ。
#
#   使い方:  ./scripts/verify-migrations.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=lib/pg-sandbox.sh
source "$REPO_ROOT/scripts/lib/pg-sandbox.sh"

PG_SANDBOX_PORT="${PG_SANDBOX_PORT:-5437}"
PG_SANDBOX_DB="from_schema_sql"

WORK="$(mktemp -d)"
cleanup() {
  pg_sandbox_stop
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> docs/schema.sql からスキーマを構築"
pg_sandbox_start "$REPO_ROOT"

echo "==> supabase/migrations/ からスキーマを構築"
pg_sandbox_psql -d postgres -qc "create database from_migrations;"
pg_sandbox_psql -d from_migrations -q -f "$REPO_ROOT/scripts/schema-test/supabase-stub.sql"

shopt -s nullglob
migrations=("$REPO_ROOT"/supabase/migrations/*.sql)
shopt -u nullglob

if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "supabase/migrations/ にマイグレーションがありません。" >&2
  exit 1
fi

for migration in "${migrations[@]}"; do
  echo "    - $(basename "$migration")"
  # pg_cron はローカルに存在しないため読み替える(cron.schedule はスタブ済み)
  sed 's/^create extension if not exists "pg_cron";/-- pg_cron: stubbed for local validation/' \
    "$migration" > "$WORK/migration.sql"
  chmod a+r "$WORK" "$WORK/migration.sql"
  pg_sandbox_psql -d from_migrations -q -f "$WORK/migration.sql"
done

echo "==> スキーマダンプを比較"
dump() {
  pg_sandbox_psql -d "$1" -tAq <<'SQL'
-- テーブル・列・型・NOT NULL・デフォルト
select 'column|' || table_name || '|' || column_name || '|' || data_type
       || '|' || is_nullable || '|' || coalesce(column_default, '-')
from information_schema.columns
where table_schema = 'public'
union all
-- 制約(CHECK / UNIQUE / PK / FK)。定義そのものを比べる。
select 'constraint|' || rel.relname || '|' || con.conname || '|'
       || pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relnamespace = 'public'::regnamespace
union all
-- インデックス
select 'index|' || indexname || '|' || indexdef
from pg_indexes where schemaname = 'public'
union all
-- 関数の本体
select 'function|' || p.proname || '|' || md5(pg_get_functiondef(p.oid))
from pg_proc p
where p.pronamespace = 'public'::regnamespace
union all
-- ビューの定義
select 'view|' || viewname || '|' || md5(definition)
from pg_views where schemaname = 'public'
union all
-- RLS の有効・強制状態
select 'rls|' || c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
union all
-- RLS ポリシー
select 'policy|' || tablename || '|' || policyname || '|'
       || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
from pg_policies where schemaname = 'public'
union all
-- ENUM 型のラベルと並び
select 'enum|' || t.typname || '|' || e.enumlabel || '|' || e.enumsortorder::text
from pg_type t join pg_enum e on e.enumtypid = t.oid
union all
-- トリガ
select 'trigger|' || c.relname || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
order by 1;
SQL
}

dump "$PG_SANDBOX_DB"   > "$WORK/from-schema-sql.txt"
dump from_migrations    > "$WORK/from-migrations.txt"

if diff -u "$WORK/from-schema-sql.txt" "$WORK/from-migrations.txt" > "$WORK/diff.txt"; then
  echo
  echo "==> 一致: docs/schema.sql と supabase/migrations/ は同じスキーマを作る"
  echo "    ($(wc -l < "$WORK/from-schema-sql.txt") 項目を比較)"
  exit 0
fi

echo
echo "==> 不一致: docs/schema.sql と supabase/migrations/ がずれています" >&2
echo "    - は docs/schema.sql 側のみ、+ は supabase/migrations/ 側のみ" >&2
echo >&2
cat "$WORK/diff.txt" >&2
exit 1
