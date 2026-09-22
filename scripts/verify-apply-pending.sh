#!/usr/bin/env bash
#
# supabase/apply-pending.sql が supabase/migrations/ の未適用分と同じ結果を作り、
# かつ何度実行しても壊れないことを検証する。
#
# apply-pending.sql は本人が Supabase の SQL Editor へ1回のコピペで貼るための
# ファイルで、内容は migrations/ の写しになる。写しは放っておけばずれるため、
# ここで機械的に突き合わせる。
#
# 手順:
#   1. 「本番相当」= 既に適用済みのマイグレーションだけを入れた DB を作る
#   2. そこへ apply-pending.sql を適用する(2回実行して冪等性も見る)
#   3. 「全マイグレーションを入れた DB」とスキーマダンプを比較する
#
#   使い方:  ./scripts/verify-apply-pending.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=lib/pg-sandbox.sh
source "$REPO_ROOT/scripts/lib/pg-sandbox.sh"

PG_SANDBOX_PORT="${PG_SANDBOX_PORT:-5438}"
# 共通ヘルパは PG_SANDBOX_DB に docs/schema.sql を適用する。ここでは使わない DB を渡し、
# 比較用の2つは自分で作る(ヘルパ側は他の検証スクリプトと共有なので触らない)。
PG_SANDBOX_DB="apply_pending_scratch"

# 本番へ未適用のマイグレーション(TASKS.md の B-4/B-5/B-7/B-10/B-12/B-13/B-14/B-15)。
# apply-pending.sql がこの分を受け持つ。
PENDING=(
  20260908001200_rescued_emails.sql
  20260908001300_rescued_emails_rls.sql
  20260912000100_net_worth_snapshots.sql
  20260912000200_net_worth_snapshots_rls.sql
  20260913000100_transaction_splits.sql
  20260913000200_transaction_splits_rls.sql
  20260913000300_import_batches_receipt_image.sql
  20260913000500_app_settings_google_backup.sql
  20260914000100_goals.sql
  20260914000200_goals_rls.sql
  20260921000100_transaction_diagnoses.sql
  20260921000200_transaction_diagnoses_rls.sql
  20260921000300_ai_monthly_reports.sql
  20260921000400_ai_monthly_reports_rls.sql
  20260921000500_ai_daily_reports.sql
  20260921000600_ai_daily_reports_rls.sql
)

WORK="$(mktemp -d)"
cleanup() {
  pg_sandbox_stop
  rm -rf "$WORK"
}
trap cleanup EXIT

is_pending() {
  local name="$1"
  for p in "${PENDING[@]}"; do
    [[ "$p" == "$name" ]] && return 0
  done
  return 1
}

# pg_cron はローカルに無いため読み替える(verify-migrations.sh と同じ)
apply() {
  local db="$1" file="$2"
  sed 's/^create extension if not exists "pg_cron";/-- pg_cron: stubbed/' "$file" > "$WORK/step.sql"
  chmod a+r "$WORK" "$WORK/step.sql"
  pg_sandbox_psql -d "$db" -q -f "$WORK/step.sql"
}

echo "==> 「本番相当」の DB を用意(未適用分を除いたマイグレーション)"
pg_sandbox_start "$REPO_ROOT"
pg_sandbox_psql -d postgres -qc "create database apply_pending_base;"
pg_sandbox_psql -d apply_pending_base -q -f "$REPO_ROOT/scripts/schema-test/supabase-stub.sql"
pg_sandbox_psql -d postgres -qc "create database all_migrations;"
pg_sandbox_psql -d all_migrations -q -f "$REPO_ROOT/scripts/schema-test/supabase-stub.sql"

for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$migration")"
  apply all_migrations "$migration"
  if is_pending "$name"; then
    continue
  fi
  apply apply_pending_base "$migration"
done

echo "==> apply-pending.sql を適用"
apply apply_pending_base "$REPO_ROOT/supabase/apply-pending.sql"

echo "==> もう一度適用(冪等であること)"
apply apply_pending_base "$REPO_ROOT/supabase/apply-pending.sql"

echo "==> スキーマダンプを比較"
dump() {
  pg_sandbox_psql -d "$1" -tAq <<'SQL'
select 'column|' || table_name || '|' || column_name || '|' || data_type
       || '|' || is_nullable || '|' || coalesce(column_default, '-')
from information_schema.columns
where table_schema = 'public'
union all
select 'constraint|' || rel.relname || '|' || con.conname || '|'
       || pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relnamespace = 'public'::regnamespace
union all
select 'index|' || indexname || '|' || indexdef
from pg_indexes where schemaname = 'public'
union all
select 'rls|' || c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
union all
select 'policy|' || tablename || '|' || policyname || '|'
       || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
from pg_policies where schemaname = 'public'
union all
select 'enum|' || t.typname || '|' || e.enumlabel || '|' || e.enumsortorder::text
from pg_type t join pg_enum e on e.enumtypid = t.oid
union all
select 'trigger|' || c.relname || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
order by 1;
SQL
}

dump apply_pending_base > "$WORK/after-apply-pending.txt"
dump all_migrations     > "$WORK/all-migrations.txt"

if diff -u "$WORK/all-migrations.txt" "$WORK/after-apply-pending.txt" > "$WORK/diff.txt"; then
  echo
  echo "==> 一致: apply-pending.sql は未適用分と同じスキーマを作る(2回実行しても同じ)"
  echo "    ($(wc -l < "$WORK/all-migrations.txt") 項目を比較)"
  exit 0
fi

echo
echo "==> 不一致: apply-pending.sql が supabase/migrations/ とずれています" >&2
echo "    - は全マイグレーション、+ は apply-pending.sql 適用後" >&2
echo >&2
cat "$WORK/diff.txt" >&2
exit 1
