# Hallmarkの導入とアプリのデザイン

Hallmark v2をUI制作・監査の開発ツールとして導入した。アプリ利用者の通信先・保存先は増やさない。

## 導入元

- https://github.com/Nutlope/hallmark
- コミット: `7ec868225c6caa040558c321ee0fefa0e73f83a8`
- ライセンス: MIT（`.agents/skills/hallmark/LICENSE` を保持）
- 配置: `.agents/skills/hallmark`。Claude用の `.claude/skills/hallmark` は同じ内容への相対シンボリックリンク。
- `SKILL.md`、`references/`、`scripts/`、`agents/` とテーマの参照画像を保持。上流のインストーラと同様に検証用fixturesを除外した。
- グローバルインストーラは実行していない。バージョンとコミットは `.hallmark/upstream.json` に記録。

## 使う

```text
$hallmark redesign app/(app)
$hallmark audit app/(app)
```

```bash
npm run design:refs
npm run design:lint
npm run design:lint -- --render --url http://localhost:3000/spending
```

描画検証にはChrome/Chromiumが必要。通常の場所になければ `CHROME_PATH` を指定する。Puppeteerは開発依存で、ブラウザ本体は自動ダウンロードしない。ログイン後の画面は、本人の認証セッションまたはローカルQAのダミー認証で描画する。ログイン画面だけの描画を家計簿全体の検証とは呼ばない。

テスト用データは `scripts/design-qa` のローカル偽サーバーを使用する。本番データ・秘密情報をテストへコピーしない。検証の描画結果は `.hallmark/` 内でgit管理から除外する。

## デザインの維持

`design.md` が共通の仕様。全ルートとリンク先、フォーム、データ取得・保存・照合・金額計算を引き継ぐ。スマホは一列、十分な画面幅では主情報と補助情報を並べる。配色選択、明暗表示、状態色の意味を維持し、主操作・フォーカス・余白・文字の階層を統一する。

スキルは48テーマや写真ライブラリを持つが、家計簿の実画面へ装飾写真や架空の金額を追加するためには使わない。写真を別途採用する場合は各写真のライセンス・表示クレジットを確認する。Together APIや画像生成は任意であり、この導入でAPIキーは不要。

## 更新

更新したい上流コミットを先に選ぶ。`skills/hallmark` の配布対象を比較し、LICENSEを含めてローカル配置を更新する。`design:refs` とテーマ検証、静的・ブラウザ確認を通し、`.hallmark/upstream.json` を変更して通常のPRでレビューする。上流の `install.mjs` はグローバル配置を置き換えるため、このプロジェクトの更新には使わない。
