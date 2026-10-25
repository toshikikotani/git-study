<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UIの制作とレビュー

Hallmark v2をこのプロジェクトの `.agents/skills/hallmark/SKILL.md` に導入している。UIの制作・改善では、このスキルとルートの `design.md` を読み、既存の配色・機能・フォームと金額計算を維持する。既存画面の全面改修はユーザーが依頼した範囲に限る。

- Codex: `$hallmark redesign app/(app)`、レビューのみなら `$hallmark audit app/(app)`。
- Claude Code: `.claude/skills/hallmark` から同じスキルを参照する。
- 静的チェック: `npm run design:lint`。ブラウザ付き: `npm run design:lint -- --render --url http://localhost:3000/spending`。
- テーマ・参照ファイルの確認: `npm run design:refs`。導入元・更新方法は `docs/hallmark/README.md`。
