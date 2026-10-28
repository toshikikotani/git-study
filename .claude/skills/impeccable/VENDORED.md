# Impeccable(取り込んだもの)

- 出どころ:https://github.com/pbakaus/impeccable の `.claude/skills/impeccable/`
  (コミット d34c87e1a00989ae8dbdd7f6b30b70f23319e860、スキル v4.8.0、engine 0.1.18)。
- ライセンス:Apache-2.0(`LICENSE`)。iOS / Android の参照は ehmo/platform-design-skills(MIT)から(`NOTICE.md`)。
- 取り込む前に、`SKILL.md`・`reference/*.md`・起動スクリプト `scripts/impeccable` を読んで確かめた(ADR-136)。

## 入れていないもの

- `scripts/live-browser*.js`・`scripts/modern-screenshot.umd.js`(ブラウザの live モード用の大きな JS)
- `scripts/data/font-index*.json`(フォントの索引)
- `scripts/impeccable.cmd`(Windows 用の起動)
- 編集のたびに検査を走らせるフック(`.claude/settings.json` の hooks)と、専用のサブエージェント

そのため `live`・`generate`・フォント選びは使えない。点検(`audit`・`critique`)・仕上げ(`polish` など)と
検査(`scripts/impeccable detect`)は使える。

## 検査の本体

`scripts/impeccable` は、初回に GitHub のリリース(`engine-v0.1.18`)から本体を `~/.impeccable/bin/` に取り、
`scripts/engine-checksums.txt` の SHA-256 と合うときだけ使う。

- ファイルを調べる:`.claude/skills/impeccable/scripts/impeccable detect --json app src`
- 描いた画面を調べる(Chromium を `--remote-debugging-port` で起動して):
  `.claude/skills/impeccable/scripts/impeccable detect --json --cdp <port> --target <URL の一部>`

## 更新するとき

上のリポジトリの同じ場所から、入れていないものを除いて上書きし、差分を読んでから入れる。
