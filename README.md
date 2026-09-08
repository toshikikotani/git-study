# 個人資産形成システム(仮称)

高金利負債の完済と、その後の資産形成を「意志力ではなく構造」で支えるための、本人専用シングルユーザー Web アプリケーション。

家計簿アプリではなく **個人財務のリファクタリング環境** として設計する。

## ステータス

設計完了、基盤実装中。進捗は [`TASKS.md`](TASKS.md) を参照。

- 完了:プロジェクト初期化、JST/金額ヘルパ、完済シミュレーションのロジック、ホーム画面の骨組み、CI
- 次:CSV パーサ、分類エンジン、Supabase 接続(アカウント作成待ち)

## ドキュメント

| ファイル | 内容 |
|---|---|
| [`TASKS.md`](TASKS.md) | タスクボード。**開発はここから始める** |
| [`docs/requirements.md`](docs/requirements.md) | 要求仕様書 v0.1(入力ドキュメント) |
| [`docs/schema.sql`](docs/schema.sql) | Supabase / PostgreSQL スキーマ(26テーブル) |
| [`docs/architecture.md`](docs/architecture.md) | システム構成・ディレクトリ構成・責務分担 |
| [`docs/mvp-plan.md`](docs/mvp-plan.md) | MVP のタスク分割(28タスク) |
| [`docs/decisions.md`](docs/decisions.md) | 設計判断の記録(ADR-001〜015) |

## 技術スタック

Next.js 16 (App Router) / TypeScript / Tailwind CSS v4 / Supabase (PostgreSQL, Auth, pg_cron) / Vercel / GitHub Actions / Claude API / Discord Webhook

## セットアップ

```bash
npm install
cp .env.example .env.local   # 値を埋める
npm run dev
```

Supabase / Vercel / Anthropic のアカウントが未作成でも、`npm run test` と `npm run verify:schema` は動く。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run lint` | ESLint |
| `npm run format` | Prettier で整形 |
| `npm run typecheck` | 型検査 |
| `npm run test` | 単体テスト |
| `npm run verify:schema` | `docs/schema.sql` を一時 PostgreSQL に流し、制約・関数・RLS を検証 |
| `./scripts/gen-payoff-golden.sh` | SQL 版シミュレーションの出力を fixture に書き出す |

`verify:schema` と `gen-payoff-golden.sh` はローカルに PostgreSQL 15 以上(`initdb` / `pg_ctl` / `psql`)が必要。Ubuntu なら `apt-get install -y postgresql-16`。

## デプロイ

ホスティングは Vercel(ADR-012)。**現時点では環境変数なしでデプロイできる。** Supabase もまだ読んでいないため、公開すると仮の数字が入ったホーム画面が表示される。

1. [vercel.com](https://vercel.com) に GitHub アカウントでログイン
2. **Add New → Project** からこのリポジトリを選ぶ
3. Framework Preset に **Next.js** が自動で選ばれることを確認し、設定は変えずに **Deploy**

以降、`main` への push で自動デプロイされる。

### 公開前に知っておくこと

- **認証はまだ無い**(M0-3)。URL を知っている人は誰でも開ける。現在は仮の数字しか出ないため実害はないが、**実際の明細や負債を入れる前に M0-3 を終えること**
- 検索エンジンには拾われないようにしてある(`app/robots.ts` と `metadata.robots`)。ただしこれは検索避けであって、アクセス制限ではない
- URL を人に見せたくない段階なら、Vercel の **Settings → Deployment Protection → Vercel Authentication** を有効にすると、本人のログインが必要になる

### 環境変数を入れる段階になったら

`.env.example` の項目を Vercel の **Settings → Environment Variables** に入れる。`SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` / `DISCORD_WEBHOOK_URL` / `CRON_SECRET` は Production のみで良い。GitHub Actions 側にも同じ値が要る(定期ジョブ用、ADR-009)。

## 設計上の約束

コードを書く前に読むべきもの。破ると金額が静かに間違う。

1. **金額は整数の円。支出が負、収入が正**(ADR-008)。`src/domain/money.ts` を経由する
2. **金利は小数**(15% → `0.15`)。パーセント値を保存しない。DB の `CHECK` が 1 を超える値を拒否する
3. **「今日」は必ず JST で判定する**(ADR-015)。`src/lib/date.ts` を経由し、`new Date()` を直接使わない
4. **完済シミュレーションは SQL と TypeScript の二重実装**。変更するときは必ず両方を揃える。CI が乖離を検出する(`docs/architecture.md` §3.1)
5. **秘密情報は環境変数のみ**。DB にもリポジトリにも入れない(NFR-04)
6. **UI バリデーションを理由に DB 制約を外さない**。UI は親切のため、DB 制約は正しさのためにある
