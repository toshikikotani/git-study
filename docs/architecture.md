# アーキテクチャ

要求仕様書 v0.1 8章「システム構成(推奨)」に基づく実装構成。選定の根拠は `docs/decisions.md`(ADR-001, 009, 011, 012)を参照。

## 1. 全体像

```
                       ┌──────────────────────────────┐
                       │  本人のスマートフォン / PC     │
                       └───────────┬──────────────────┘
                                   │ HTTPS
                       ┌───────────▼──────────────────┐
                       │  Vercel (Next.js App Router)  │
                       │  ─ Server Component  : 表示    │
                       │  ─ Server Action     : 更新    │
                       │  ─ Route Handler     : ジョブ受口 │
                       └───────────┬──────────────────┘
                                   │ postgres-js / PostgREST
                       ┌───────────▼──────────────────┐
                       │  Supabase                     │
                       │  ─ PostgreSQL + RLS           │
                       │  ─ Auth (Magic Link)          │
                       │  ─ pg_cron(死活のみ)          │
                       └───────────▲──────────────────┘
                                   │
        ┌──────────────────────────┴────────────────────────┐
        │  GitHub Actions (schedule)                         │
        │   07:00 morning-brief   / 毎時 detect-alerts        │
        │   03:00 import-gmail    / 日次 keepalive(冗長)     │
        └──────┬─────────────────────────┬──────────────────┘
               │                         │
     ┌─────────▼────────┐      ┌─────────▼─────────┐
     │  Claude API       │      │  Discord Webhook  │
     │  (Haiku 4.5)      │      │                   │
     │  分類 / 要約       │      │  通知 / 朝配信     │
     └───────────────────┘      └───────────────────┘
```

**この構成の要点**

- 永続データは Supabase にしか無い。Vercel は捨てても復元できる(NFR-03)
- 外部 API を呼ぶジョブはすべて GitHub Actions が起点。DB からは外部へ出て行かない
- pg_cron が担うのは「DB 自身を生かす」1本だけ。GitHub Actions が全滅しても Supabase は停止しない(NFR-05)

## 2. ディレクトリ構成

モノレポにはしない。個人開発では構成要素の数がそのまま放置リスクになる。

```
.
├── README.md
├── TASKS.md                         # タスク管理ボード(開発ループの単一の入口)
│
├── docs/
│   ├── requirements.md              # 要求仕様書 v0.1
│   ├── schema.sql                   # スキーマ全体像(人間が読む正)
│   ├── architecture.md              # 本ファイル
│   ├── mvp-plan.md                  # MVP のタスク分割
│   └── decisions.md                 # ADR
│
├── supabase/
│   ├── config.toml
│   ├── migrations/                  # 実際に適用される正(docs/schema.sql を分割したもの)
│   │   ├── 20260908000100_extensions_and_enums.sql
│   │   ├── 20260908000200_core_tables.sql
│   │   ├── 20260908000300_transactions.sql
│   │   ├── 20260908000400_rules_and_transfers.sql
│   │   ├── 20260908000500_briefs_and_alerts.sql
│   │   ├── 20260908000600_functions_and_views.sql
│   │   ├── 20260908000700_rls.sql
│   │   └── 20260908000800_cron.sql
│   └── seed.sql                     # seed_defaults() の呼び出し
│
├── app/                             # Next.js App Router(ルーティングと画面だけ)
│   ├── layout.tsx
│   ├── globals.css
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (app)/
│   │   ├── layout.tsx               # ナビゲーション + チェックイン記録
│   │   ├── page.tsx                 # ホーム(数字3個:FR-03, FR-14, FR-61)
│   │   ├── debts/
│   │   │   ├── page.tsx             # 一覧 + 完済シミュレーション(FR-01〜05)
│   │   │   └── [id]/page.tsx
│   │   ├── transactions/
│   │   │   ├── page.tsx             # 明細一覧
│   │   │   └── review/page.tsx      # 確認待ちキュー(FR-12)
│   │   ├── import/page.tsx          # CSV 取り込み(FR-10)
│   │   ├── rules/page.tsx           # 分類ルール・カテゴリ編集(FR-13)
│   │   ├── payday/page.tsx          # 振替チェックリスト(FR-15)
│   │   ├── briefs/                  # 朝配信のアーカイブ(FR-32)
│   │   └── settings/page.tsx        # app_settings 編集(NFR-02)
│   └── api/
│       ├── cron/
│       │   ├── morning-brief/route.ts
│       │   ├── detect-alerts/route.ts
│       │   ├── import-gmail/route.ts
│       │   └── keepalive/route.ts
│       └── health/route.ts
│
├── src/
│   ├── domain/                      # 純粋関数。DB も fetch も触らない
│   │   ├── money.ts                 # 円の整数演算・表示整形
│   │   ├── payoff.ts                # 完済シミュレーション(SQL 版と同一ロジック)
│   │   ├── budget.ts                # 残額・消化率
│   │   ├── payday.ts                # 振替の配分計算
│   │   └── streak.ts
│   ├── features/                    # 機能単位。domain + データアクセスを束ねる
│   │   ├── debts/
│   │   ├── transactions/
│   │   ├── classification/
│   │   │   ├── rules.ts             # ルール適用(決定的)
│   │   │   ├── ai.ts                # Claude 呼び出し(バッチ)
│   │   │   └── risky.ts             # FR-21 リボ/キャッシング検知
│   │   ├── import/
│   │   │   ├── csv.ts
│   │   │   └── adapters.ts          # 列マッピング・文字コード・日付形式
│   │   ├── payday/
│   │   ├── briefs/
│   │   │   ├── collect.ts
│   │   │   ├── filter.ts            # FR-31 除外と除外理由の記録
│   │   │   └── render.ts
│   │   └── alerts/
│   │       ├── detect.ts
│   │       └── notify.ts
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts            # Server Component / Action 用(anon + RLS)
│   │   │   ├── admin.ts             # service_role。ジョブからのみ import 可
│   │   │   └── types.ts             # supabase gen types で自動生成
│   │   ├── claude.ts
│   │   ├── discord.ts
│   │   ├── env.ts                   # 起動時に環境変数を検証(zod)
│   │   └── date.ts                  # JST 固定のヘルパ(ADR-015)
│   └── components/
│       ├── ui/
│       └── charts/
│
├── scripts/
│   ├── verify-schema.sh             # ローカル PostgreSQL でスキーマを検証
│   └── schema-test/
│       ├── supabase-stub.sql
│       └── verify.sql
│
├── tests/
│   ├── domain/                      # 計算ロジックの単体テスト(最重要)
│   └── features/
│
└── .github/workflows/
    ├── ci.yml                       # lint / typecheck / test / verify-schema
    ├── morning-brief.yml            # 07:00 JST
    ├── detect-alerts.yml            # 毎時
    ├── import-gmail.yml             # 03:00 JST
    └── keepalive.yml                # 日次
```

## 3. 責務分担

### 3.1 層ごとの責務

| 層 | 責務 | やってはいけないこと |
|---|---|---|
| `app/` | ルーティング、認証ガード、フォーム、表示 | 金額の計算。SQL の組み立て |
| `src/features/` | ユースケースの組み立て、DB アクセス、外部 API 呼び出し | 純粋な計算ロジックを抱え込むこと(`domain/` へ出す) |
| `src/domain/` | 利息・残額・配分の計算。純粋関数のみ | I/O。日時の暗黙取得(引数で受ける) |
| `src/lib/` | 外部サービスのクライアント、環境変数、日付ヘルパ | 業務判断 |
| PostgreSQL | 制約による整合性の保証、集計、シミュレーション関数 | 外部 HTTP 呼び出し |

**計算ロジックが SQL と TypeScript の両方にある件について。**
完済シミュレーションは `public.simulate_total_payoff()`(SQL)と `src/domain/payoff.ts`(TS)の二重実装になる。これは意図的な重複である。

- SQL 版:朝配信ジョブ・集計・本人が psql で検算する用途。DB だけで完結することに価値がある
- TS 版:画面上でスライダーを動かしながら即座に再計算する用途。往復レイテンシがあると使い物にならない

**両者が一致することはテストで保証する**(`tests/domain/payoff.test.ts` が同じ入力で SQL 関数と TS 関数を突き合わせる)。この対応を欠くと数字が二種類存在することになり、本システムの信頼が崩れる。テストは CI の必須項目とする。

### 3.2 フロントエンド

- **Server Component を既定とする。** 金額を読む画面は `export const dynamic = 'force-dynamic'` を明示し、キャッシュによる古い数字の表示を禁じる
- **Client Component は入力と即時再計算にだけ使う。** 完済シミュレーションのスライダー、CSV の列マッピング UI、確認待ちキューの操作
- **ホーム画面の数字は3個まで**(FR-61)。完済まで残り日数 / 生活費の残額 / 女遊び枠の残額。それ以外は下層へ置く
- **金額の表示は必ず `formatYen()` を経由する。** 桁区切りと符号の扱いを1箇所に閉じ込める
- **モバイルファースト**(NFR-07)。ホームはスクロールなしで数字3個が収まること

### 3.3 バックエンド(Server Action / Route Handler)

| 種別 | 用途 | 認証 |
|---|---|---|
| Server Action | 画面からの更新(債務の編集、分類の修正、チェックリストの完了) | Supabase セッション(anon キー + RLS) |
| Route Handler `/api/cron/*` | GitHub Actions からのジョブ起動 | `Authorization: Bearer ${CRON_SECRET}` |
| Route Handler `/api/health` | 死活確認 | なし |

**`service_role` キーの扱い**:`src/lib/supabase/admin.ts` からのみ参照する。このファイルは先頭に `import 'server-only'` を置き、クライアントバンドルへの混入をビルドエラーにする。

### 3.4 定期ジョブ

| ジョブ | 実行 | 基盤 | 内容 |
|---|---|---|---|
| `morning-brief` | 07:00 JST | GitHub Actions | 収集 → FR-31 フィルタ → 要約 → Discord 送信 → `daily_briefs` 保存 |
| `detect-alerts` | 毎時 | GitHub Actions | FR-20/21/22/23 の判定 → `alerts` へ登録 → 未送信分を Discord へ |
| `import-gmail` | 03:00 JST | GitHub Actions | カード通知メール取得 → 構造化 → `transactions` へ(フェーズ2) |
| `keepalive` | 日次 | pg_cron **と** GitHub Actions | `job_runs` へ1行書く。二重化して片方が死んでも停止させない |

**すべてのジョブが守る規約**

1. 開始時に `job_runs` へ `status='running'` で1行 INSERT し、終了時に更新する(NFR-06)
2. 失敗したら `alerts` に `kind='job_failure'` を積む。ジョブの失敗が静かに握り潰されない
3. 冪等であること。同じ日に二度走っても二重送信しない(`daily_briefs` は `(user_id, brief_on)` にユニーク制約、`alerts` は `dedup_key`)
4. GitHub Actions の `schedule` は数分〜十数分遅れる。時刻ではなく日付で判定する

### 3.5 データ整合性の責務

制約は「アプリのバグが金額を静かに壊すこと」を防ぐために置いている。UI バリデーションは親切のため、DB 制約は正しさのためにある。**UI 側の検証を理由に DB 制約を外してはならない。**

主要な制約と、それが止める事故:

| 制約 | 止める事故 |
|---|---|
| `ck_debts_rate` (0〜1) | 金利を `15.0` と入力し、利息が100倍になる |
| `ck_debts_paid_off_zero` | 残高があるのに完済扱いになり、カウントダウンが嘘になる |
| `ux_transactions_fingerprint` | 同じ CSV を二度取り込んで支出が倍になる |
| `ck_transactions_ai_needs_confidence` | 確信度なしの AI 分類が閾値判定をすり抜け、本人確認に回らない |
| `ux_alerts_user_dedup` | 同じアラートを何度も送り、通知が無視されるようになる |
| `ck_app_settings_env_key_is_name` | Webhook URL の実値を DB に保存してしまう(NFR-04) |
| `ck_transfer_rules_amount_shape` | 金額の無い振替ルールがチェックリストに現れる |

## 4. データの流れ

### 4.1 CSV 取り込みから分類まで(FR-10〜FR-13)

```
CSV ファイル
  │ ① 文字コード判定・パース(import_adapters の列マッピングに従う)
  ▼
正規化済み行の配列
  │ ② import_batches を作成(checksum が既存なら中断:二重取り込み防止)
  ▼
transactions へ INSERT
  │   fingerprint はトリガが自動生成 → 重複行は unique violation で自然に落ちる
  ▼
③ classification_rules を priority 昇順で適用(決定的・AI 不使用)
  │   ここで payment_method が確定する ── リボ/キャッシング/分割の検知はこの段階
  ▼
④ 未分類の残りだけを Claude へバッチ送信(20〜50件/リクエスト)
  │   → category_id + confidence を得る
  ▼
⑤ confidence >= 閾値 → review_status='auto_ok'
   confidence <  閾値 → review_status='pending'(確認待ちキューへ)
  ▼
⑥ 本人が修正 → review_status='corrected'
   → その修正から classification_rules を1件生成(is_learned=true)
   → 次回から③で処理され、AI 呼び出しが減る
```

**③を④より先に置くことが重要である。** ルールが増えるほど AI 呼び出しが減り、ランニングコストが逓減する(NFR-01)。本人の修正が「システムを軽くする」方向に効くため、整えるほど報われる構造になる(設計原則1・6)。

### 4.2 リボ・キャッシング検知(FR-21)

再発防止の最重要トリガー。**AI に判断させない**(ADR-010)。

```
transactions への INSERT / UPDATE
  ▼
classification_rules の正規表現マッチ(priority 1〜3)
  → payment_method が 'revolving' / 'cashing' / 'installment' に確定
  ▼
detect-alerts ジョブが部分索引 ix_transactions_risky_payment で拾う
  ▼
alerts に severity='critical' で登録(dedup_key = 'risky:<transaction_id>')
  ▼
Discord へ即時送信
```

摘要文字列に検知語が出ない金融機関もある。その場合は CSV の「支払区分」列を `import_adapters.payment_method_column` でマッピングして補う。

### 4.3 給料日の振替(FR-15)

```
給料日(app_settings.payday)到来、または給与入金を検知
  ▼
transfer_rules を execution_order 昇順で評価
  ① fixed      → 定額を確保
  ② percentage → 入金額に対する割合
  ③ remainder  → 残り全額(最後の1件)
  ▼
transfer_runs + transfer_run_items を生成(status='pending')
  ▼
本人はチェックリストを上から消化するだけ。当日の判断は不要(設計原則4)
```

## 5. 環境変数

| 変数 | 置き場所 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Supabase エンドポイント |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | ブラウザ用。RLS 前提で公開されてよい |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, GitHub Secrets | ジョブ用。**絶対にクライアントへ渡さない** |
| `ANTHROPIC_API_KEY` | Vercel, GitHub Secrets | 分類・要約 |
| `DISCORD_WEBHOOK_URL` | Vercel, GitHub Secrets | 通知・朝配信 |
| `CRON_SECRET` | Vercel, GitHub Secrets | `/api/cron/*` の認証 |
| `APP_BASE_URL` | GitHub Secrets | Actions が叩く先 |

`src/lib/env.ts` で zod により起動時に検証する。設定漏れはデプロイ後の実行時ではなく、ビルド時か起動直後に落とす。**リポジトリに `.env` を含めない**(NFR-04)。`.env.example` のみを置く。

## 6. スキーマの管理方法

`docs/schema.sql` は **人間が全体像を読むための正**、`supabase/migrations/*.sql` は **実際に適用される正**。

- 初回構築時、`docs/schema.sql` を上記の8ファイルに機械的に分割して `migrations/` へ置く
- 以降の変更は `migrations/` に追加ファイルとして積み、`docs/schema.sql` にも同じ変更を反映する
- 両者の乖離を防ぐため、CI で「まっさらな PostgreSQL に `migrations/` を全適用した結果」と「`docs/schema.sql` を適用した結果」のスキーマダンプを比較する

**スキーマ検証**:`scripts/verify-schema.sh` がローカルの PostgreSQL 16 に `docs/schema.sql` を流し、制約・シミュレーション関数・RLS が期待通りに動くことを確認する。Supabase 固有の `auth.users` / `auth.uid()` / `pg_cron` は `scripts/schema-test/supabase-stub.sql` で最小限に模す。CI(`ci.yml`)で毎回実行する。

## 7. テスト方針

金融データを扱うため、**計算が合っていることの保証を最優先**する。

| 対象 | 手段 | 必須度 |
|---|---|---|
| `src/domain/` の計算 | 単体テスト。境界値(残高0、金利0、返済額が利息未満)を必ず含む | 必須 |
| SQL 関数と TS 関数の一致 | 同一入力で両者を実行して突き合わせ | 必須 |
| DB 制約 | `scripts/schema-test/verify.sql`。「入ってはいけないデータが拒否されること」を検証 | 必須 |
| CSV アダプタ | 実ファイルを匿名化した fixture でのゴールデンテスト | 必須 |
| 分類 AI | プロンプトの回帰を見る少数の固定ケース。精度そのものは追わない | 任意 |
| 画面 | 手動確認で足りる。個人利用のため E2E は投資対効果が低い | 任意 |

## 8. セキュリティ(NFR-04)

- 認証は Supabase Auth の Magic Link。Supabase 側でサインアップを無効化するか、許可メールアドレスを本人のみに制限する
- 全テーブルで RLS を有効化し、`force row level security` を付ける。`service_role` のみが `BYPASSRLS` で越えられる
- API キー・Webhook URL は環境変数のみ。DB にもリポジトリにも入れない。`app_settings` が持つのは環境変数の**名前**だけ
- `/api/cron/*` は `CRON_SECRET` を検証する。検証失敗は 401 を返し、理由を本文に書かない
- 明細には店名が含まれる。ログに明細本文を出さない。エラーログには ID のみを記録する
- 依存パッケージは Dependabot で更新を追う

## 9. コスト試算(NFR-01)

| サービス | プラン | 月額 |
|---|---|---|
| Vercel | Hobby | 0 円 |
| Supabase | Free(500MB / 帯域 5GB) | 0 円 |
| GitHub Actions | Free(public リポジトリなら無制限、private は月2,000分) | 0 円 |
| Discord | Webhook | 0 円 |
| Claude API | 従量 | 数十〜数百円 |

Claude API の内訳(概算):明細分類が月300件でバッチ50件/回として月6リクエスト、朝配信が日次30リクエスト。Haiku 4.5 の単価であれば合計で月100円前後に収まる見込み。ルール学習が進むほど分類の呼び出しは減る。

**容量**:`transactions` が年間3,600行程度、10年で36,000行。Supabase Free の500MBに対して問題にならない。増えるとすれば `daily_briefs.body_md` と `job_runs.detail` なので、`keepalive` の `job_runs` は90日で自動削除する(スキーマ §9 に実装済み)。
