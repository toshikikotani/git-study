#!/usr/bin/env bash
#
# docs/schema.sql をローカルの PostgreSQL に流し、制約・シミュレーション関数・RLS が
# 期待どおりに動くことを検証する。CI(.github/workflows/ci.yml)からも実行する。
#
#   使い方:  ./scripts/verify-schema.sh
#
#   前提:    PostgreSQL 15 以上のサーバ実行ファイル(initdb / pg_ctl / psql)
#            Ubuntu なら: apt-get install -y postgresql-16
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=lib/pg-sandbox.sh
source "$REPO_ROOT/scripts/lib/pg-sandbox.sh"

PG_SANDBOX_PORT="${PG_SANDBOX_PORT:-5433}"
PG_SANDBOX_DB="schema_verify"

trap pg_sandbox_stop EXIT

echo "==> 一時 PostgreSQL に docs/schema.sql を適用"
pg_sandbox_start "$REPO_ROOT"

echo "==> 機能・制約・RLS を検証"
pg_sandbox_psql -f "$REPO_ROOT/scripts/schema-test/verify.sql"

echo
echo "==> スキーマ検証: 成功"
