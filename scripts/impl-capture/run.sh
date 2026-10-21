#!/usr/bin/env bash
#
# 実装の全画面を、サンプルデータ入りで描画して取り込む(デザインのキャンバスに起こすため)。
# Postgres(マイグレーション適用)+ PostgREST + 偽の認証で、ログイン済みとして各画面を開く。
# 結果は impl-capture-out/ に出す(スクリーンショット・DOM・CSS)。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K="$ROOT/scripts/impl-capture"
W="${IMPL_WORK:-/tmp/impl}"
OUT="$ROOT/impl-capture-out"
mkdir -p "$W/pg/sock" "$OUT"

BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
"$BIN/initdb" -D "$W/pg/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
"$BIN/pg_ctl" -D "$W/pg/data" -o "-p 5440 -k $W/pg/sock -c listen_addresses=127.0.0.1" -l "$W/pg.log" -w start >/dev/null
P=(psql -h "$W/pg/sock" -p 5440 -U postgres -v ON_ERROR_STOP=1 -q)

"${P[@]}" -d postgres -c "create database app;"
"${P[@]}" -d app -f "$ROOT/scripts/schema-test/supabase-stub.sql"
"${P[@]}" -d app -f "$K/stub-extra.sql"
for m in "$ROOT"/supabase/migrations/*.sql; do
  sed 's/^create extension if not exists "pg_cron";/-- pg_cron stubbed/' "$m" > "$W/m.sql"
  "${P[@]}" -d app -f "$W/m.sql"
done
"${P[@]}" -d app <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'me@example.com');
select public.seed_defaults('00000000-0000-0000-0000-000000000001');
SQL
python3 "$K/seed.py" "$W/seed.sql"
"${P[@]}" -d app -f "$W/seed.sql"
G="$(psql -h "$W/pg/sock" -p 5440 -U postgres -d app -tAc "select id from genres where name='外食'")"
sed "s/__GAISHOKU__/$G/g" "$K/routes.json" > "$W/routes.json"

curl -sSL -o "$W/pgrst.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
tar -xf "$W/pgrst.tar.xz" -C "$W"
cat > "$W/pgrst.conf" <<'EOF'
db-uri = "postgres://authenticator@127.0.0.1:5440/app"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "local-render-secret-0123456789abcdef0123456789"
server-port = 54998
server-host = "127.0.0.1"
EOF
"$W/postgrest" "$W/pgrst.conf" > "$OUT/postgrest.log" 2>&1 &
node "$K/gateway.mjs" > "$OUT/gateway.log" 2>&1 &
sleep 3

export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54999
export NEXT_PUBLIC_SUPABASE_ANON_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export SUPABASE_SERVICE_ROLE_KEY=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
(cd "$ROOT" && npx next build) > "$OUT/build.log" 2>&1 || { tail -80 "$OUT/build.log"; exit 1; }

(cd "$ROOT" && NODE_OPTIONS="--require $ROOT/scripts/design-qa/fake-date.cjs" FAKE_NOW=2026-10-21T12:30:00Z \
  npx next start -p 3100) > "$OUT/next.log" 2>&1 &
for _ in $(seq 1 90); do
  curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/login | grep -q '^[23]' && break
  sleep 1
done

CAPTURE_OUT="$OUT" node "$K/capture.mjs" "$W/routes.json" | tee "$OUT/capture.log"

# 画面が読む CSS とフォント(ボードから同じ見た目で読めるように)
mkdir -p "$OUT/next"
(cd "$ROOT/.next" && find static -name '*.css' -exec cp --parents {} "$OUT/next/" \;)
[ -d "$ROOT/.next/static/media" ] && cp -r "$ROOT/.next/static/media" "$OUT/next/static/"
echo "done"
