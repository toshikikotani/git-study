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
#   Supabase 固有の auth.users / auth.uid() / pg_cron は
#   scripts/schema-test/supabase-stub.sql で最小限に模す。
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${VERIFY_PG_PORT:-5433}"
WORKDIR="$(mktemp -d)"
PGDATA="$WORKDIR/pgdata"
SOCKET_DIR="$WORKDIR/sock"
DB_NAME="schema_verify"

# postgres のサーバ実行ファイルは PATH に無いことが多いので探す
find_pg_bin() {
  if command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
    return
  fi
  local candidate
  candidate="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$candidate" ]]; then
    echo "$candidate"
    return
  fi
  echo "initdb が見つかりません。PostgreSQL 15 以上をインストールしてください。" >&2
  exit 1
}

PG_BIN="$(find_pg_bin)"

# root では postgres を起動できないため、非 root ユーザーへ委譲する
RUN_AS=""
if [[ "$(id -u)" -eq 0 ]]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  RUN_AS="postgres"
  chown -R postgres:postgres "$WORKDIR"
fi

as_pg() {
  if [[ -n "$RUN_AS" ]]; then
    su "$RUN_AS" -c "$*"
  else
    bash -c "$*"
  fi
}

cleanup() {
  as_pg "$PG_BIN/pg_ctl -D '$PGDATA' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$SOCKET_DIR"
[[ -n "$RUN_AS" ]] && chown -R postgres:postgres "$WORKDIR"

echo "==> 一時クラスタを初期化"
as_pg "$PG_BIN/initdb -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C" >/dev/null

echo "==> 起動 (port $PORT)"
as_pg "$PG_BIN/pg_ctl -D '$PGDATA' -o '-p $PORT -k $SOCKET_DIR' -l '$WORKDIR/pg.log' -w start" >/dev/null

PSQL=("$PG_BIN/psql" -h "$SOCKET_DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1)

"${PSQL[@]}" -qc "create database $DB_NAME;"

echo "==> Supabase スタブを適用"
"${PSQL[@]}" -d "$DB_NAME" -q -f "$REPO_ROOT/scripts/schema-test/supabase-stub.sql"

echo "==> docs/schema.sql を適用"
# pg_cron はローカルに存在しないため、その行だけ読み替える(cron.schedule はスタブ済み)
sed 's/^create extension if not exists "pg_cron";/-- pg_cron: stubbed for local validation/' \
  "$REPO_ROOT/docs/schema.sql" > "$WORKDIR/schema_local.sql"
[[ -n "$RUN_AS" ]] && chown postgres:postgres "$WORKDIR/schema_local.sql"
"${PSQL[@]}" -d "$DB_NAME" -q -f "$WORKDIR/schema_local.sql"

echo "==> 機能・制約・RLS を検証"
"${PSQL[@]}" -d "$DB_NAME" -f "$REPO_ROOT/scripts/schema-test/verify.sql"

echo
echo "==> スキーマ検証: 成功"
