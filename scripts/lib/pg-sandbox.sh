#!/usr/bin/env bash
#
# 使い捨ての PostgreSQL クラスタを立て、docs/schema.sql を適用するための共通処理。
# scripts/verify-schema.sh と scripts/gen-payoff-golden.sh が読み込む。
#
# 提供するもの:
#   pg_sandbox_start        一時クラスタを起動し、schema.sql を適用した DB を用意する
#   pg_sandbox_psql ...     用意した DB に対して psql を実行する
#   pg_sandbox_stop         停止して後片付けする(trap から呼ぶ)
#
# 変数:
#   PG_SANDBOX_PORT   使用ポート(既定 5433)
#   PG_SANDBOX_DB     データベース名(既定 schema_verify)

PG_SANDBOX_PORT="${PG_SANDBOX_PORT:-5433}"
PG_SANDBOX_DB="${PG_SANDBOX_DB:-schema_verify}"

_pg_sandbox_workdir=""
_pg_sandbox_bin=""
_pg_sandbox_runas=""

_pg_sandbox_find_bin() {
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
  return 1
}

_pg_sandbox_as() {
  if [[ -n "$_pg_sandbox_runas" ]]; then
    su "$_pg_sandbox_runas" -c "$*"
  else
    bash -c "$*"
  fi
}

pg_sandbox_start() {
  local repo_root="$1"

  _pg_sandbox_bin="$(_pg_sandbox_find_bin)" || return 1
  _pg_sandbox_workdir="$(mktemp -d)"

  # root では postgres を起動できないため非 root ユーザーへ委譲する
  if [[ "$(id -u)" -eq 0 ]]; then
    id postgres >/dev/null 2>&1 || useradd -m postgres
    _pg_sandbox_runas="postgres"
  fi

  mkdir -p "$_pg_sandbox_workdir/sock"
  [[ -n "$_pg_sandbox_runas" ]] && chown -R postgres:postgres "$_pg_sandbox_workdir"

  _pg_sandbox_as "$_pg_sandbox_bin/initdb -D '$_pg_sandbox_workdir/pgdata' -U postgres \
    --auth=trust -E UTF8 --locale=C" >/dev/null

  _pg_sandbox_as "$_pg_sandbox_bin/pg_ctl -D '$_pg_sandbox_workdir/pgdata' \
    -o '-p $PG_SANDBOX_PORT -k $_pg_sandbox_workdir/sock' \
    -l '$_pg_sandbox_workdir/pg.log' -w start" >/dev/null

  pg_sandbox_psql -d postgres -qc "create database $PG_SANDBOX_DB;"

  # Supabase 固有の auth.users / auth.uid() / pg_cron を最小限に模す
  pg_sandbox_psql -q -f "$repo_root/scripts/schema-test/supabase-stub.sql"

  # pg_cron はローカルに存在しないため、その行だけ読み替える(cron.schedule はスタブ済み)
  sed 's/^create extension if not exists "pg_cron";/-- pg_cron: stubbed for local validation/' \
    "$repo_root/docs/schema.sql" > "$_pg_sandbox_workdir/schema_local.sql"
  [[ -n "$_pg_sandbox_runas" ]] && chown postgres:postgres "$_pg_sandbox_workdir/schema_local.sql"

  pg_sandbox_psql -q -f "$_pg_sandbox_workdir/schema_local.sql"
}

pg_sandbox_psql() {
  local args=("$@")
  local has_db=0
  for a in "${args[@]}"; do
    [[ "$a" == "-d" ]] && has_db=1
  done
  if [[ $has_db -eq 0 ]]; then
    args=(-d "$PG_SANDBOX_DB" "${args[@]}")
  fi
  "$_pg_sandbox_bin/psql" \
    -h "$_pg_sandbox_workdir/sock" -p "$PG_SANDBOX_PORT" -U postgres \
    -v ON_ERROR_STOP=1 "${args[@]}"
}

pg_sandbox_stop() {
  [[ -z "$_pg_sandbox_workdir" ]] && return 0
  _pg_sandbox_as "$_pg_sandbox_bin/pg_ctl -D '$_pg_sandbox_workdir/pgdata' -m immediate stop" \
    >/dev/null 2>&1 || true
  rm -rf "$_pg_sandbox_workdir"
  _pg_sandbox_workdir=""
}
