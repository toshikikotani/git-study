-- =============================================================================
--  手入力のカテゴリ格子(N2):使用頻度による自動並び替えと、長押しでの
--  手動並べ替え・非表示
--
--  出典: docs/schema.sql(人間が全体像を読むための正)
--  この 20260930000800_genre_quick_entry.sql は実際に適用される正。
--
--  - quick_entry_order   : null のあいだは使用頻度で自動的に並ぶ。値が入ると
--    (長押しで手動並べ替えをしたジャンル)その値の昇順を頻度より優先する。
--  - hidden_in_quick_entry: 手入力のカテゴリ格子からだけ隠す(ジャンル自体は
--    残り、他の画面には影響しない)。
-- =============================================================================

begin;

alter table public.genres add column if not exists quick_entry_order integer;
alter table public.genres add column if not exists hidden_in_quick_entry boolean not null default false;

commit;
