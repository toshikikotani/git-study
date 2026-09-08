# 個人資産形成システム(仮称)

高金利負債の完済と、その後の資産形成を「意志力ではなく構造」で支えるための、本人専用シングルユーザー Web アプリケーション。

家計簿アプリではなく **個人財務のリファクタリング環境** として設計する。

## ステータス

設計フェーズ。実装は未着手。

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/requirements.md` | 要求仕様書 v0.1(入力ドキュメント) |
| `docs/schema.sql` | Supabase / PostgreSQL スキーマ |
| `docs/architecture.md` | システム構成・ディレクトリ構成・責務分担 |
| `docs/mvp-plan.md` | MVP のタスク分割 |
| `docs/decisions.md` | 設計判断の記録(ADR) |
| `TASKS.md` | タスク管理ボード |

## 技術スタック(予定)

Next.js (App Router) / Supabase (PostgreSQL, Auth, pg_cron) / Vercel / GitHub Actions / Claude API / Discord Webhook
