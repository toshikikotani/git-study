-- app_settings.classification_model のデフォルトが日付サフィックス付きの
-- モデル ID になっていた誤りを直す(ADR-010: モデル ID に日付サフィックスを
-- 付けない)。既に seed_defaults() で投入済みの行も、まだ本人が変更していない
-- 既定値のままなら合わせて直す。

alter table public.app_settings
  alter column classification_model set default 'claude-haiku-4-5';

update public.app_settings
set classification_model = 'claude-haiku-4-5'
where classification_model = 'claude-haiku-4-5-20251001';
