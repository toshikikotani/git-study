-- =============================================================================
--  AIゲートウェイ基盤(N1):AI機能の一括オフと、同一入力のキャッシュ
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000600_ai_gateway.sql は実際に適用される正。
--  以降の変更は、このファイルを書き換えるのではなく新しいマイグレーションを
--  追加し、docs/schema.sql にも同じ変更を反映すること。
--
--  - app_settings.ai_enabled: 全AI機能の一括オフ(既定 true)。オフでも
--    アプリの基本機能はすべて使える(N1本人要件)。gmail_enabled と同じ、
--    設定は残したまま条件だけ切り替える方式。
--  - ai_cache: 同一入力に対するAI応答のキャッシュ(N1本人要件「同じ入力の
--    結果はキャッシュする」)。Vercel のサーバーレス関数はプロセスをまたいだ
--    メモリを持てないため、DBに置く。キーは呼び出し側が「機能名+入力の
--    決定的な文字列」から作るハッシュ(src/lib/ai-gateway/cache.ts 参照)。
-- =============================================================================

begin;

alter table public.app_settings add column if not exists ai_enabled boolean not null default true;

create table if not exists public.ai_cache (
  cache_key      text        primary key,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  -- 呼び出し元の機能名(例: 'daily-report')。運用時に機能ごとの内訳を見るため。
  feature        text        not null,
  response_json  jsonb       not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create index if not exists ai_cache_user_id_idx on public.ai_cache (user_id);
create index if not exists ai_cache_expires_at_idx on public.ai_cache (expires_at);

commit;
