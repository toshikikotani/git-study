-- =============================================================================
--  初期データ投入
--
--  マイグレーション適用後、ユーザーを作成してから一度だけ実行する。
--  投入される内容は docs/schema.sql §8 の seed_defaults() を参照:
--    - app_settings(ADR-003〜005 の初期値)
--    - カテゴリ9件(FR-11)
--    - リボ / キャッシング / 分割の検知ルール3件(FR-21)
--    - 給料日の振替ルール4件(FR-15)
--    - 完済シミュレーションの比較シナリオ2件(FR-02)
--
--  ローカル(supabase start)では auth.users にテストユーザーが必要:
--    insert into auth.users (id, email)
--    values ('00000000-0000-0000-0000-000000000001', 'you@example.com');
-- =============================================================================

do $$
declare
  v_user_id uuid;
begin
  -- 単一ユーザー前提(ADR-011)。最初に作られたユーザーへ投入する。
  select id into v_user_id from auth.users order by created_at limit 1;

  if v_user_id is null then
    raise notice 'auth.users にユーザーがいません。Magic Link でログインしてから再実行してください。';
    return;
  end if;

  perform public.seed_defaults(v_user_id);
  raise notice '初期データを投入しました: %', v_user_id;
end;
$$;
