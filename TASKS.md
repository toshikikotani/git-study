# タスクボード

このファイルが開発ループの単一の入口。**作業を始めるときは必ずここを最初に読み、終わったら必ずここを更新する。**

- 詳細な定義は `docs/mvp-plan.md`。ここは状態を持つだけの場所
- 1タスク = 1セッション = 1コミット
- 実装中に見つかった作業は、その場で Backlog へ追記する。「あとで思い出す」は必ず失敗する

## 状態の定義

| 状態 | 意味 |
|---|---|
| **Now** | いま着手しているもの。**常に1件だけ** |
| **Next** | 依存が解けていて、すぐ着手できるもの |
| **Backlog** | やると決まっているが、依存が未解決か優先度が低いもの |
| **Blocked** | 本人の入力・外部要因を待っているもの。待っている対象を必ず書く |
| **Done** | 完了。共通の完了条件(`docs/mvp-plan.md`)を満たしたもの |

## ループの規約

1. **Now が空なら Next の先頭を Now に移す。** 選ぶ基準は `docs/mvp-plan.md` の「優先順位」
2. **Now は1件だけ。** 並行して手を出さない
3. タスクを終えたら Done へ移し、依存が解けた Backlog を Next へ繰り上げる
4. 実装中に見つけた作業は Backlog へ追記する。**タスクを増やすことを躊躇しない**
5. 設計判断が必要になったら `docs/decisions.md` に ADR を追記してから実装する
6. スキーマを変えたら `docs/schema.sql` と `supabase/migrations/` の両方を更新し、`./scripts/verify-schema.sh` を通す
7. Blocked に入れるときは「何を待っているか」を必ず書く。待ち対象が本人の入力なら、**それを聞く1行を残す**
8. 30分考えても進まないものは Blocked にして次へ行く。止まったまま粘らない

---

## Now

なし

## Next

依存が解けており、この順で着手できる。

| ID | タスク | サイズ | 依存 |
|---|---|---|---|
| M3-1 | Discord 通知基盤(Embed / dedup / 失敗記録) | S | **B-3 待ち** |

優先順位(`docs/mvp-plan.md`)は S1(負債)> S3(リボ検知)> S4(残額)> S2(取り込み)。

## Backlog

### S2 明細の取り込みと分類
| ID | タスク | サイズ | 依存 |
|---|---|---|---|
| M2-6 | カテゴリ・ルール編集画面(改名 / 予算 / ホーム表示枠の選択 / 統廃合) | M | M2-5 |
| T-7 | `TransactionStore` の Supabase 実装を足す | S | M0-3 |
| M2-7c | `/api/cron/import-gmail` と GitHub Actions ワークフロー(毎朝取得) | S | M0-3, **T-7** |

**M2-7c 着手時に発見:`TransactionStore` は sessionStorage 実装のまま(T-7 未着手)。
cron ジョブ(サーバー側、`window` を持たない)から保存しようとしても
`SessionTransactionStore.add()` は黙って何もしないため、データが静かに
消える(NFR-06 違反)。さらに `transactions.account_id` は `accounts` への
NOT NULL な外部キーだが、CSV/貼り付け画面は `buildPreview()` に
`'pending'`/`'email'`/`'gmail'` という実在しない accountId を渡している
(M6-2 が別途解消予定)。M2-7c を安全に作るには T-7(Supabase 実装)が先に
要り、T-7 を実用にするには M6-2(実口座の選択)も要る。3つとも1タスクに
収まる規模ではないため、着手せず記録のみして次へ進んだ(ループ規約8)。**

### S3 リボ・キャッシング検知と通知
| ID | タスク | サイズ | 依存 |
|---|---|---|---|
| M3-3 | アラートジョブ(毎時) | S | M3-1, M3-2 |

FR-20(浪費70%)と FR-21(リボ/キャッシング/分割)の判定そのものは
`domain/budget.ts` と `features/classification/rules.ts` に実装済み。
FR-22/FR-23 の検知(M3-2)は `domain/alerts.ts` / `features/alerts/store.ts`
に実装済み(下記 Done)。M3-3 は依然 M3-1(**B-3 待ち**)にも依存。


### S5 朝配信の最小版
| ID | タスク | サイズ | 依存 |
|---|---|---|---|
| M5-1 | 配信内容の生成(冒頭数字 + 1トピック、除外ログ) | M | M1-5, M4-1 |
| M5-2 | 配信ジョブ(07:00 JST) | S | M5-1, M3-1 |
| M5-3 | 配信アーカイブ画面 | S | M5-1 |

### S6 口座管理と請求突合(実運用フィードバックで追加、FR-16〜18)
| ID | タスク | サイズ | 依存 |
|---|---|---|---|
| M6-2 | 取り込み時に口座を選べるようにする(`accountId` の `'pending'`/`'email'`/`'gmail'` 固定を解消) | S | M6-1, T-7 |
| M6-3 | 給料日〜給料日の期間ビュー(保存は暦月のまま表示のみ変換、ADR-015) | M | M6-2 |
| M6-4 | 請求金額メールとの突合(取り込み漏れ検知) | M | M6-2 |

### S7 投資(本人の希望で着手、FR-50〜52)
| ID | タスク | サイズ | 依存 |
|---|---|---|---|
| M7-2 | 投資記録画面(拠出・残高の手入力) | M | M7-1 |
| M7-3 | 完済検知による高リスク枠解禁 | S | M7-1, M1-2 |

### フェーズ2以降(MVP 対象外)
| ID | タスク | 対応 |
|---|---|---|
| P2-1 | Gmail 連携(カード通知メールの解析。リボ検知の主経路) | FR-10, FR-21 |
| P2-2 | 朝配信の本実装(市場・キャンペーン、FR-31 フィルタ拡充) | FR-30, FR-31 |
| P2-3 | ストリーク表示(途切れても責めない文言) | FR-62 |
| P3-1 | 副業トラッカー(作業時間・入金・時給換算) | FR-40, FR-42 |
| P3-2 | 転職準備チェックリスト | FR-41 |
| P4-2 | 口座連携 API の再検討 | 9.5 |

### 改善・技術的負債
ここには実装中に気づいたことを積む。空でよい。

| ID | タスク | 理由 |
|---|---|---|
| T-2 | CSV アダプタの fixture を実ファイル(匿名化)で用意する | 実フォーマットが判明してから |
| T-3 | ESLint 10 へ上げる | `eslint-config-next` 同梱の `eslint-plugin-react` が 10 系で動かないため 9 系に固定中(ADR-001)。上流の対応待ち |
| T-5 | `/rules` の置きページを実画面に置き換える | ナビのリンク切れを typedRoutes で検出できる状態を保つための暫定(`/debts` は M1-2、`/payday` は M4-3 で実画面化済み。`/transactions` も実装済みだが保存先は T-7 待ち) |
| T-6 | `ImportAdapter`(TS)と `import_adapters`(DB)の対応を型で保証する | 現在は手で揃えている。`supabase gen types` が入ったら派生させる(M0-2 後) |
| T-7 | `TransactionStore` の Supabase 実装を足す | 現在は sessionStorage 実装。画面は差し替えだけで動く(M0-3) |
| T-9 | 列マッピングを `import_adapters` に保存して再利用する | 現在は毎回推測。同じ形式を繰り返すなら保存した方が早い(M0-3 後) |
| T-11 | AI が救済したメールの書式をラベル辞書へ還元する | AI に回った本文を残しておけば、辞書に語を足して費用ゼロの経路へ戻せる(ADR-019) |
| T-12 | `src/domain/payoff.ts` の `simulateTotalPayoff`(110行)を分割する | SQL 版との golden fixture 一致検証(M1-1)に守られているので、単独セッションで golden テストを都度流しながら進める。ついでに直せる範囲ではない |
| T-13 | `src/features/import/adapters.ts` の `guessMapping` / `mapRow` を分割する | 列推測とパースが1関数に同居している。T-2(実ファイル fixture)と合わせてやると安全 |
| T-16 | Supabase の Auth 設定(Site URL / Redirect URLs)がリポジトリに残っていない | ダッシュボード側の設定のみで管理している。プロジェクトを作り直す場合に再設定が必要。`supabase/config.toml` の `[auth]` セクションで宣言的に管理する方法もあるが、現状は未導入 |
| T-21 | `detectInactivity()`(FR-22)を実データに接続する | 判定関数自体は M3-2 で完成しているが、「直近の取り込み日」を読む先の `transactions` テーブルが T-7 まで空のまま。T-7 完了後、`features/alerts/store.ts` に `detectAndRecordInactivityAlert()` を追加して配線する |

**T-12 は refactor(責務分離)の一環として認識しているが未着手。他は2026-09-08 の refactor セッションで着手した3画面の重複解消と mail-sync の分割のみ完了(下記 Done)。** 全体的な「5行ルール」適用は際限がないので、次に触る画面・関数から都度直す方針にする(一括では手を出さない)。

## Blocked

| ID | タスク | 待っているもの |
|---|---|---|
| B-1 | 負債の正確な内訳を `debts` に入力し `is_estimated` を落とす | **本人の棚卸し**(全借入先の残高・金利・件数・返済日)。仮値のままでも開発は進むが、完済予定日は確定表示できない |
| B-2 | 実際の金融機関 CSV でアダプタを検証する | **本人が利用中の銀行・カードの明細ファイル**(1ヶ月分) |
| B-3 | Discord Webhook URL を GitHub Secrets / Vercel に設定する | **本人による Webhook 発行**。M3-1 の着手前に必要 |

## Done

| ID | タスク | 完了日 |
|---|---|---|
| D-1 | 要求仕様書 v0.1 を `docs/requirements.md` として取り込み | 2026-09-08 |
| D-2 | `docs/decisions.md` — 14章の未決事項に初期値を選定(ADR-001〜015) | 2026-09-08 |
| D-3 | `docs/schema.sql` — 7章のデータモデルを PostgreSQL スキーマ化(26テーブル / 制約 / 索引 / RLS / シミュレーション関数) | 2026-09-08 |
| D-4 | `docs/architecture.md` — 8章に基づく構成・ディレクトリ・責務分担 | 2026-09-08 |
| D-5 | `docs/mvp-plan.md` — 11章の MVP を1セッション粒度の28タスクへ分割 | 2026-09-08 |
| D-6 | `scripts/verify-schema.sh` — スキーマをローカル PostgreSQL で検証(制約 / 関数 / RLS) | 2026-09-08 |
| D-7 | `TASKS.md` — 本ボードの作成 | 2026-09-08 |
| M0-1 | Next.js 16 / TS strict / Tailwind 4 / ESLint / Prettier / Vitest の初期化 | 2026-09-08 |
| M0-4 | `src/lib/env.ts`(zod)、`.env.example`、CI(lint / format / typecheck / test / build / スキーマ検証) | 2026-09-08 |
| M0-5 | ルートレイアウト、JST ヘルパ(`src/lib/date.ts`)、`formatYen()`、ホームの器 | 2026-09-08 |
| M1-1 | `src/domain/payoff.ts` と SQL 関数の一致検証(golden fixture 方式、CI で乖離を検出) | 2026-09-08 |
| M1-5 | ホームの完済カウントダウンと進捗ゲージ(数値は仮置き。M4-2 で実データへ) | 2026-09-08 |
| M2-1 | CSV パーサとアダプタ(Shift_JIS 自動判定 / RFC4180 / 和暦 / 出金入金2列 / 支払区分) | 2026-09-08 |
| M2-2 | 明細タブ(一覧・CSV取り込み・列の自動推測・重複排除・リボ検知の表示) | 2026-09-08 |
| M2-3 | ルールベース分類エンジン(5種のマッチ / 優先度 / FR-21 検知 / 修正からの学習) | 2026-09-08 |
| M4-1 | `domain/budget.ts` 残額計算(振替・対象外の除外 / 繰越 / FR-20 の閾値判定) | 2026-09-08 |
| T-1 | `docs/schema.sql` を `supabase/migrations/` へ分割し、乖離検出を CI に追加(890項目を比較) | 2026-09-08 |
| ADR-016 | カテゴリの表示名・予算・ホーム表示枠を `categories` に集約し、UI の直書きを廃止 | 2026-09-08 |
| M2-7 | 通知メールの取り込み(ラベル辞書の解析 / IMAP 検索の組み立て / 2段の重複排除 / Gmail 設定画面 / 貼り付けの逃げ道)ADR-018 | 2026-09-08 |
| M2-7a | 読めなかったメールを `claude-haiku-4-5` で救済(抽出は AI、リボ検知は正規表現のまま)ADR-019 | 2026-09-08 |
| M2-7b | `ImapMailSource` の実装(imapflow + mailparser で `MailSource` を満たす。テストは偽クライアントで資格情報なしに実行) | 2026-09-08 |
| M0-2 | Supabase プロジェクト作成(Tokyo リージョン)、マイグレーション9本を Management API 経由で適用、本人のアカウントで `seed_defaults()` 実行(カテゴリ9・ルール3・振替ルール4・シナリオ2)、`gen types typescript` で `src/lib/supabase/types.ts` 生成 | 2026-09-08 |
| M0-3 | 認証(Magic Link、`shouldCreateUser: false` でサインアップ拒否)、`proxy.ts` による認証ガード(画面は `/login` へリダイレクト、API は 401)、`src/lib/supabase/{client,server,admin}.ts` の分離。副作用として T-10(`/api/import/email` の無認証呼び出し)を解消 | 2026-09-08 |
| T-14 | リファクタ:取り込み3画面(CSV/貼り付け/Gmail設定)の重複排除と mail-sync の分割 | `DETECTION_RULES` の複製を `DEFAULT_DETECTION_RULES`(rules.ts)に一本化、共通 `<Card>`(components/ui)を切り出して9箇所のインライン複製を解消、「分類→StoredTransaction化→保存」を `features/transactions/import-pipeline.ts` に集約(CSV・貼り付け・mail-sync の3箇所が同じロジックを持っていた)。`syncFromMailbox`(82行)を `parseMessage` / `pushWarnings` に分割し、`import-pipeline.ts` の `buildPreview` を呼ぶ形にして3つ目の複製も解消。テスト10件追加、既存317件は無変更で通過。2026-09-08 |
| D-8 | `docs/glossary.md` — DB列名↔TS識別子↔画面表示名の対応表、接尾辞規約(`...Yen`/`...On`/`...At`/`...Id`/`is...`/`...Rate`)、型の置き場所、データアクセス層の命名規約(list/get/create/update)を制定。既存コードは無改修、以後のコードが従う基準 | 2026-09-08 |
| M1-2 | 負債の登録・編集画面。`src/features/debts/store.ts`(Supabase 読み書き、この機能で最初に本物の DB を使う層)、`src/domain/debt.ts`(借入先・返済日の検証)、`money.ts` に `parseAnnualRate()` を追加。Server Action(`app/(app)/debts/actions.ts`)経由で作成・更新。実際の Supabase プロジェクトに対して認証込みで読み書き・RLS を検証済み(本セッション内で一時セッションを発行して確認)。あわせて `seed_defaults()` に ADR-006 の負債3件が投入されていない欠落を発見・修正(新規マイグレーション、schema.sql 反映、decisions.md 追記)。本番へ適用し、既存ユーザーに対して `seed_defaults()` を再実行してカードA・カードB・消費者金融Cの3件を投入済み | 2026-09-08 |
| ADR-012 | Vercel(Hobby)へ初回デプロイ。プロジェクト作成、環境変数3件(`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`)を production に設定、CLI から本番デプロイ。認証ガードが本番でも効くことを確認(未ログインで `/login` へリダイレクト)。公開 URL: `https://git-study-lemon.vercel.app` | 2026-09-08 |
| T-15 | Vercel プロジェクトと GitHub リポジトリを連携(本人が GitHub App をインストール)。`main` への push で自動デプロイになることを確認 | 2026-09-08 |
| T-17 | Magic Link のリンク先が localhost になるバグを修正。原因は Supabase の Site URL が既定値 `http://localhost:3000` のままだったこと。`config/auth` API で `site_url` を本番 URL へ、`uri_allow_list` に本番 URL とローカル開発用ポートを設定。実際にリンクを発行して本番 URL へリダイレクトされることを確認 | 2026-09-08 |
| T-18 | 負債タブ等の切り替えが遅い不具合を修正。原因は Vercel の Function リージョンが `iad1`(米国東部)、Supabase が Tokyo で、動的ページ1回の描画のたびに太平洋を2往復していたこと。`serverlessFunctionRegion` と `functionDefaultRegions` を `hnd1`(東京)へ変更し再デプロイ | 2026-09-08 |
| T-19 | タブ切り替え直後にローディング表示を出す。`src/components/ui/skeleton.tsx` と、ホーム・`/debts` それぞれの `loading.tsx`(Next.js の規約、データ取得中は自動でこちらが出る)を追加。Playwright で実際にクリック直後スケルトンが出て、データ到着後に本来の内容(カードA・推定バッジ)へ差し替わることを確認 | 2026-09-08 |
| M2-4 | `src/features/classification/ai.ts` — Claude Haiku 4.5 によるバッチ分類。**関数自体のみ**(本人の選択により、取り込み経路への接続は M2-3b で別途行う)。`ClaudeTransactionClassifier.classifyMany()` が既定40件ずつに分けてリクエストし(100件は3リクエスト以内)、カテゴリは uuid でなく `code` でやり取り(トークン節約・改名耐性)。応答件数が入力と不一致なら当て推量せずバッチ全体を確認待ちにする、選択肢に無い code は null 扱いにするなど、モデルの出力を信用しきらない設計はメール抽出(ADR-019)と同型。`applyConfidenceThreshold()` で「AI がどう思ったか」と「閾値を信用するかどうか」を分離(ADR-010)。テスト13件追加(偽 client によるバッチ分割・失敗時の握り潰さない挙動・閾値境界)。あわせて `app_settings.classification_model` の既定値に日付サフィックス付きモデル ID(`claude-haiku-4-5-20251001`)が紛れ込んでいた誤りを発見し、修正マイグレーションと `docs/schema.sql` を追加(本番 DB への適用は未実施。既存の分類コードはこの設定値を参照せず定数で動くため、現時点でこのバグが機能をブロックすることはない) | 2026-09-08 |
| M1-3 | `/debts` に完済シミュレーション区画を追加。`domain/payoff.ts` の `comparePlans()`(既存・純粋関数)をそのまま使い、Client Component(`payoff-simulation.tsx`)でスライダーを動かすたびサーバーを介さず即時再計算。アバランチ/スノーボールの切り替え、最低返済のみとの比較(短縮月数・削減利息・完済見込み日)を表示。スライダーの下限は最低返済額の合計、上限は残高合計と初期値の3倍のいずれか大きい方。あわせて `app_settings` の読み出しを `src/features/settings/store.ts` に切り出し(`home/summary.ts` の重複を解消)、`debts/store.ts` に `toPayoffDebt()` を追加して `Debt → domain/payoff.ts の Debt` への変換ロジックの重複も解消。実データ(残債合計1,000,000円・最低返済合計28,000円)で実際に画面を描画し、スライダー操作・戦略切り替えで数字が往復なしに変わることを Playwright で確認(月10万円: 45ヶ月短縮・289,723円削減、月50万円に変更: 53ヶ月短縮・346,876円削減) | 2026-09-08 |
| M4-2 | ホームの残額表示を実データに接続。`loadHomeSummary()` が Supabase から debts / app_settings / categories / budgets(当月分。無ければ `default_monthly_budget_yen` で代用)/ transactions(当月・対象カテゴリ)/ debt_payments(当月の元本減少)を読むよう差し替え、`PLACEHOLDER_*` を削除。あわせて `debts.original_principal_yen` をフォームに追加(任意入力。進捗ゲージの分母。未入力なら現在残高で代用し、その負債単体の進捗は0%からになる)。`loadHomeSummary()` は Supabase(`next/headers` の `cookies()`)に触れる関数になったためユニットテストの対象から外し(純粋関数の `buildHomeTiles`/`computePayoffSummary` は継続してテスト)、実データでの検証は本セッション内で一時セッションを発行してホーム画面を実際に描画し確認した(残債合計1,000,000円、生活費・聖域タイルとも実データ(0円)で表示) | 2026-09-08 |
| T-20 | ログインをパスワード優先に変更(ADR-011 改定) | 毎回メールを開いてリンクを押す手間が継続利用を阻害していたため。`/login` にパスワード/メールリンクの2タブを用意し、パスワードを既定に。`src/domain/auth.ts` に `assertPassword`/`assertPasswordConfirmed` を追加(8文字以上・確認一致)。`/settings/password` に Server Action(`updateUser({password})`)を新設し、Magic Link ログイン後は毎回ここへ誘導して次回からパスワードで入れるようにした。実際に Node 側で Magic Link セッションを発行してブラウザへ注入し、実サーバー(localhost)相手にパスワード設定フォームを送信 → ホームへリダイレクトを確認。設定したパスワードでの `signInWithPassword` 成功・誤ったパスワードでの拒否も実際の Supabase プロジェクトに対して確認済み(ブラウザから Supabase への直接リクエストはこのサンドボックスのプロキシ制約で検証できないため、そこだけ Node 側の直接呼び出しで代替検証)。テスト4件追加 | 2026-09-08 |
| M6-1 | 口座(カード)の登録・編集画面(FR-16、実運用フィードバックで追加した S6 の初手)。`/accounts`。`src/features/accounts/store.ts`(`accounts` の list/create/update)、`src/domain/account.ts`(口座名・締め日・支払日の検証)。締め日・支払日の 1〜31 範囲チェックは `domain/debt.ts` の `assertPaymentDay` と全く同じロジックだったため、`src/lib/date.ts` に `isValidDayOfMonth()` として切り出し、両ドメインから参照する形に統一(既存の返済日テストは無改修で通過)。`/transactions` に「口座」への導線を追加。実際に Supabase セッションを発行し、口座の新規登録・一覧表示・リロード後の永続確認・編集・空文字での更新拒否まで実ブラウザ操作で確認済み。テスト8件追加(account 5件、既存 debt テストは回帰なし) | 2026-09-09 |
| M7-1 | 投資額の自動算出ロジック(FR-50, FR-52。本人の希望で S7 として着手)。`src/domain/investment.ts` の `computeInvestmentPlan()` — 返済目標額 × `investment_ratio_of_repayment` を投資総額とし、`is_high_risk_unlocked` が立つまでは全額インデックス枠、立った後は `high_risk_allocation_ratio` でインデックス/高リスクに分ける(純粋関数)。`features/settings/store.ts` の `AppSettings` にこの3列を追加。`/investments` で「今月の投資目安」を表示し、`/debts` から導線を追加。実データ(返済目標10万円・比率20%)で実際に画面を描画し、20,000円と表示されること、`/debts` からのリンク遷移を Playwright で確認。テスト5件追加 | 2026-09-09 |
| M1-4 | 借り換えシミュレーション(FR-04)。`domain/payoff.ts` に `compareRefinance()` を追加 — `comparePlans()`(返済額を変えた効果)と対になる、金利だけを変えた効果を見る純粋関数。`/debts` に「借り換えを試す」区画(`refinance-simulation.tsx`)を追加し、年利入力に応じて即時再計算。`repayment_scenarios` への保存(`src/features/scenarios/store.ts`、`user_id,name` の unique 制約に upsert)・削除・一覧を実装し、`src/domain/scenario.ts` にシナリオ名の検証を追加。実際に Supabase セッションを発行し、年利変更で数字が変わること、保存したシナリオがリロード後も残ること、削除で消えることを実ブラウザ操作で確認済み(検証用シナリオは削除済み、既存の`最低返済のみ`/`月10万円返済`シードは対象外)。テスト4件追加(compareRefinance 2件、assertScenarioName 2件、既存 payoff テストは回帰なし) | 2026-09-09 |
| M4-3 | 振替ルール編集画面(FR-15)。`/payday` を置きページから実画面へ(T-5)。`src/features/transfer-rules/store.ts`(list/create/update/delete、`listCategoryOptions()`)、`src/domain/transfer-rule.ts`(ルール名・金額指定方式ごとの検証。fixed/percentage/remainder で必要な列だけ埋める)。並び替えは隣接2件の `execution_order` を負の一時値を経由して入れ替え、`ux_transfer_rules_order`(一意制約)に一時的にも触れないようにした。DB 制約違反(`ux_transfer_rules_remainder` など)を本人に伝わる文言に変換する `describeConstraint()` を追加。実際に Supabase セッションを発行し、シードの4ルール(返済→投資→聖域枠→生活費)の表示、並び替え(↑/↓ボタン、DB の `execution_order` で確認)、2件目の「残り全額」ルール作成が拒否されメッセージが出ること、新規作成・改名・削除の一連の流れを実データで確認済み(検証はすべて DB の実値で確認。Server Action 後の DOM 読み取りは revalidate のタイミングにより不安定だったため、断定は DB クエリで行った)。テスト8件追加 | 2026-09-09 |
| M3-2 | 残りの検知(FR-22 未取込 / FR-23 返済日前日)。`src/domain/alerts.ts`(純粋関数)に `detectInactivity()`/`detectPaymentDueTomorrow()` を追加。返済日は 29〜31 日指定をその月の実際の末日に丸めて比較(`domain/payoff.ts` と同じ考え方)。`src/features/alerts/store.ts` に `recordAlerts()`(`alerts` の `(user_id, dedup_key)` 一意制約へ `upsert` + `ignoreDuplicates` で重複を静かに無視)と、実データで動く `detectAndRecordPaymentDueAlerts()` を追加。FR-22 側は「取り込みの空白日数」の判定ロジックは完成しているが、読み出す先の `transactions` テーブルが T-7 まで空のため接続は見送り(T-21 に記録)。実際の Supabase プロジェクトに対し、実セッションでの `debts` 取得 → 候補生成 → `alerts` への upsert → 同じ候補での再実行が重複を作らないこと(0件挿入)を確認し、検証用データは削除済み。テスト10件追加 | 2026-09-09 |
| M0-6 | keepalive ジョブ(NFR-05)。`app/api/cron/keepalive/route.ts` — `Authorization: Bearer ${CRON_SECRET}` を `timingSafeEqual` で検証(不一致・欠落は401)、全ユーザー分の `job_runs` 行を `trigger_source='github_actions'` で書き込む。`.github/workflows/keepalive.yml`(日次 `18:00 UTC` = 03:00 JST。pg_cron 側の 03:15 JST とはずらして二重化、ADR-009)。副作用として `src/lib/env.ts` の `getServerEnv()` を発見・修正:1つの必須スキーマに `SUPABASE_SERVICE_ROLE_KEY`/`ANTHROPIC_API_KEY`/`DISCORD_WEBHOOK_URL`/`CRON_SECRET` をまとめていたため、未設定の Discord/Anthropic キーに `CRON_SECRET` だけを使いたい呼び出し元まで巻き添えでエラーになる欠陥があった(このルートで初めて顕在化するところだった)。`getGmailEnv()` と同じ「機能ごとに検証する」方針で `getSupabaseServiceRoleKey()`/`getCronSecret()`/`getAnthropicApiKey()`/`getDiscordWebhookUrl()` の4関数に分割、`tests/domain/env.test.ts` を新API向けに書き換え。ローカルに `CRON_SECRET` を新規発行して実際の Supabase プロジェクトに対して検証:認証なし→401、誤った秘密→401、正しい秘密→200 かつ `job_runs` に1行追加されることを確認。検証中、`started_at` を DB のデフォルト(INSERT実行時刻)任せにすると `finished_at` より後になり得る不整合を発見・修正(アプリ側で計測した開始時刻を明示的に渡す形に変更)。検証用の行は削除済み(pg_cron 側の実行記録は温存)。`docs/env.example` の `CRON_SECRET`/`APP_BASE_URL` はそのまま流用 | 2026-09-09 |
| M2-3b | 分類エンジンを取り込み経路へ接続する(T-8)。CSV 取り込み・メール貼り付けの両画面で、ルール(`DEFAULT_DETECTION_RULES`)に当たらず「確認待ち」のまま残る明細を AI 分類(M2-4)へ回せるようにした。`src/features/classification/store.ts`(新規、`'server-only'`)— `listCategoryOptions()`(カテゴリを `code`/`name` で取得)、`classifyUnclassified()`(AI を呼び `applyConfidenceThreshold()` で確信度判定、`code`→`categoryId` への変換もここで行う。`ANTHROPIC_API_KEY` 未設定なら全件「確認待ち」のまま返す、エラーにはしない)。`app/api/classify/route.ts`(新規。認証は proxy.ts の関所が担う。1回300件までの上限)。`features/settings/store.ts` の `AppSettings` に `classificationConfidenceThreshold` を追加。画面側は `src/features/transactions/classify-client.ts`(2画面共通の fetch ラッパー)と、各ページの「AI に回す」ボタン(メール貼り付けの AI 救済ボタンと同じ、明示的に押されたときだけ呼ぶ設計)。AI の結果は `id` をキーにしたローカルの Map で重ね合わせ、`useEffect` 内での `setState` を避けて `useMemo` だけで導出(react-hooks/set-state-in-effect の指摘を受けて設計を直した)。実際の Supabase プロジェクトに対し、認証済みセッションで `/api/classify` を叩いて401→200になること、`ANTHROPIC_API_KEY` 未設定時に全件「確認待ち」+警告文が返ること、`categories`(code 9件)・`app_settings.classification_confidence_threshold`(0.8)の新しい読み出しが実際に動くことを確認(このサンドボックスに Playwright が依存関係として入っておらず、ブラウザでのクリック確認は未実施。API 契約はボタンが送るのと同じ形で確認済み)。なお `classification_rules`(DB 保存の学習済みルール)を取り込み経路へ実際に読み込ませる部分は本タスクの対象外(M2-5「確認待ちキューと修正のルール化」の責務。現状 `DEFAULT_DETECTION_RULES` はカテゴリを一切設定しないため、ルールで分類が付く明細は今のところ無い) | 2026-09-09 |
| M4-4 | 給料日チェックリスト(FR-15)。`/payday` にチェックリスト区画を追加(M4-3のルール編集と同じページ、上に表示)。`domain/transfer-rule.ts` に `computeTransferPlan()` を追加 — 給与は変動するため固定の月収設定を持たず、実際の入金額を本人に入力してもらい、それを execution_order 順に fixed/percentage/remainder へ按分する純粋関数(remainder は残り全部、fixed 合計が入金額を超える場合は以降を0円に切り詰めてマイナスにしない)。`src/features/transfer-runs/store.ts`(新規)の `resolvePaydayChecklistState()` が「①未完了の実行があればそれを最優先」「②無ければ今月分の run_on が既に存在するか」「③今日が今月の給料日(`app_settings.payday`、新規追加)以降か」の順で判定し、`needs_amount`(入金額の入力を促す)/`checklist`(消化中)/`none`(何も出さない)の3状態を返す。`createPaydayRun()` が振替ルールを取得して按分し `transfer_runs`+`transfer_run_items` を作成、`setTransferRunItemDone()` がチェックのたびに `actual_amount_yen` を予定額で埋め、全項目完了で実行自体も `status='completed'` にする。実際に Supabase セッションを発行し(`app_settings.payday` を検証のため一時的に本日の日付へ変更→検証後25へ復元)、入金額300,000円を入力→シードの4ルールが100,000/20,000/40,000/140,000円に按分されて表示→4項目を順にチェック→全完了メッセージと `status='completed'` を確認、再訪問時に同じ完了済み実行が再表示されない(ルール編集画面のみに戻る)ことをブラウザ操作とDBクエリの両方で確認。検証用データは削除済み。テスト5件追加(computeTransferPlan) | 2026-09-09 |
| M1-6 | 返済実績の記録と計画差分(FR-05)。`/debts` の各負債カードに「返済実績」区画を追加。`src/features/debts/payments-store.ts`(新規)の `recordDebtPayment()` — 元本・利息の内訳は本人に入力させず、現在残高×年利から利息分を自動算出(`monthlyInterest()`)し、残りを元本の減少に充てる。支払額が利息にも満たない月は元本を据え置く(残高は減らないがエラーにはしない)。過払い分は利息側に寄せて `principal_yen + interest_yen = amount_yen`(DB制約)を常に満たす。残高が0円になれば `status='paid_off'`・`paid_off_on` を設定(`ck_debts_paid_off_zero`/`ck_debts_paid_off_date` を満たす)。`domain/debt-payment.ts` に `computePlanActualDelta()`(純粋関数)を追加 — `original_principal_yen` を起点に `simulateDebtPayoff()`(既存)で計画を再現し、これまでの返済回数の行と実際の残高を比較して差分を表示(`original_principal_yen` 未入力時は計画の起点が定まらないため差分を出さない)。実際に Supabase セッションを発行し、①最低返済額どおりの返済(差分「計画どおり」)、②追加返済(差分「計画より12,000円進んでいます」、`is_extra=true`)、③残高5,000円の一時的な負債を作って全額+利息を返済し `status='paid_off'` への遷移と一覧からの除外を確認 — 利息・元本の自動按分を3ケースとも手計算と一致することを DB クエリで確認。検証用データは削除済み(一時負債は削除、シードのカードBは残高・当初元本を復元)。テスト5件追加(computePlanActualDelta) | 2026-09-10 |
| M2-5 | 確認待ちキューと修正のルール化(学習)。「確認待ち」のまま残る明細を本人が一括で見て修正できる画面と、その修正から学習ルールを増やす仕組みを追加。`/transactions/review`(新規、Server Component が `listCategoryOptions()` を渡し `ReviewQueue` に描画させる)— `reviewStatus === 'pending'` の明細だけを一覧し、カテゴリ選択+「確定」で `TransactionStore.update()`(新規メソッド)により修正、続けて `createLearnedRuleAction()`(新規 Server Action)を呼んで学習ルールを1件増やす。ルール作成の失敗は分類の確定自体をブロックせず、警告として蓄積して表示。`src/features/classification/store.ts` に `listActiveClassificationRules()`(DB保存のルールを画面向け `ClassificationRule` 型へ変換)と `createLearnedRule()`(既存の `buildLearnedRule()`/`extractKeyword()` を使い、摘要からキーワードを抽出して `classification_rules` へ `is_learned=true` で insert。キーワードが短すぎる場合は `RuleError` で拒否)を追加。`app/api/classification-rules/route.ts`(新規)と `src/features/transactions/rules-client.ts`(新規、`fetchLearnedRules()`)で、CSV 取り込み・メール貼り付けの両画面が起動時にこの DB 保存ルールを取得し `DEFAULT_DETECTION_RULES` と合わせて `buildPreview()` に渡すようにした(M2-3b で「対象外」と明記していた、学習ルールを取り込み経路へ実際に読み込ませる部分)。実装中に発見・修正したバグ:`buildPreviewRow()` がルールに当たって `categoryId` が設定された場合でも `categoryName` を常に `null` のまま返していたため、学習ルールが効いても画面には「未分類」と表示され続けていた(`DEFAULT_DETECTION_RULES` が `categoryId` を一切設定しないため今まで顕在化しなかった)。`buildPreview()`/`buildPreviewRow()` に `categoryNameById` マップ引数を追加して修正。実際に Supabase セッションを発行し、①確認待ちの明細をカテゴリ確定→`classification_rules` に正しい `pattern`/`category_id` で1行増えることを DB クエリで確認、②同じ店名の2件目の明細を貼り付け→`classifiedBy: 'rule'`(「AI に回す」ボタンが出ないことで確認)かつカテゴリ名が「未分類」ではなく正しい名称(修正前は失敗していた)で表示されることを Playwright のブラウザ操作で確認。検証用ルールは削除済み。テスト2件追加(categoryNameById の解決あり/なし) | 2026-09-10 |

---

## 本人への確認待ち

実装を先に進めるうえで、いずれ必要になるもの。急ぎ順。

1. **Discord Webhook**(B-3):サーバーとチャンネルを1つ作り、Webhook URL を発行
2. **負債の棚卸し**(B-1):借入先ごとの残高・金利・最低返済額・返済日。`/debts` にシードの3件が表示されているので、「編集」から直接正確な値に直せる
3. **明細 CSV 1ヶ月分**(B-2):利用中の銀行・カードのもの。フォーマットが判明するとアダプタを実データで検証できる
4. **GitHub Secrets への `CRON_SECRET` / `APP_BASE_URL` 設定**(M0-6):`.github/workflows/keepalive.yml` が参照する。リポジトリの Settings → Secrets and variables → Actions で本人が設定する必要がある(このセッションからは触れない領域)。`CRON_SECRET` は Vercel の production 環境変数にも同じ値を設定すること。値は `openssl rand -hex 32` などで新規発行してよい
