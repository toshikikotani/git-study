begin;

-- 読み取れたレシートを「保存前」として残す(v5 変更2、ADR-133)。保存は本人が「保存」を押したときだけに
-- したので、読み取り結果を画面の中だけに持つと、再読み込みやアプリを閉じたときに消える。入力待ちと同じ表に
-- status = 'ready' で置き、保存したら resolved、捨てたら discarded にする。
alter table public.receipt_captures drop constraint if exists ck_receipt_captures_status;
alter table public.receipt_captures add constraint ck_receipt_captures_status
  check (status in ('ready', 'needs_input', 'resolved', 'discarded'));

-- レシートの「確かめる細かさ」(v5 変更5、ADR-133)。しっかり(thorough)/ふつう(normal、既定)/少なめ(light)。
alter table public.app_settings
  add column if not exists receipt_check_level text not null default 'normal';
alter table public.app_settings drop constraint if exists ck_app_settings_receipt_check_level;
alter table public.app_settings add constraint ck_app_settings_receipt_check_level
  check (receipt_check_level in ('thorough', 'normal', 'light'));

commit;
