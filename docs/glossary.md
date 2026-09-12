# 用語・命名の対応表

コードを書く前に読む。**目的は「同じ概念に2つの名前が付く事故」を防ぐこと。**
`amountYen` と `amount` と `yen` が別々の場所で同じものを指す、といった状態は
レビューでは気づきにくく、気づいた頃には直す箇所が画面数だけ散らばっている。

- 既存コードは合わせなくてよい。ここは**これから書くコードのための基準**
- ここに無い概念を新しく書くときは、この表に1行足してから実装する
- DB 列名が正。TS 側の名前は DB 列名から機械的に導ける形にする(下記の変換規則)

## 命名の3層

同じ概念が3つの層を通る。層ごとに書式は変わるが、**語そのものは変えない**。

| 層 | 書式 | 例 |
|---|---|---|
| DB 列(`docs/schema.sql`) | snake_case | `current_balance_yen` |
| TS 識別子(型・変数・関数) | camelCase | `currentBalanceYen` |
| 画面表示(日本語ラベル) | 名詞 | 「現在残高」 |

変換は機械的(snake_case → camelCase)。`balance` と `currentBalanceYen` のように
語を削ったり言い換えたりしない。省略したくなったら、それは「新しい概念」を
作っているサインなので、この表に別の語として足す。

**例外**:計算専用の局所型(例: `domain/payoff.ts` の `Debt.balanceYen`)は、
その関数群の中でしか使わない前提で短い名前を許容してよい。ただし DB から読んだ
行をそのまま渡す層(store・query・Server Action の引数)では必ず正式名を使う。

## 接尾辞の規約

| 接尾辞 | 型 | 意味 | 例 |
|---|---|---|---|
| `...Yen` | `number` | 円額。整数、支出が負・収入が正(ADR-008) | `amountYen`, `minimumPaymentYen` |
| `...On` | `DateOnly`(`'YYYY-MM-DD'`) | 日付(時刻を持たない) | `occurredOn`, `paymentDay` は例外(日にち番号) |
| `...At` | `string`(ISO timestamp) | 日時(時刻を持つ)。DB の `timestamptz` 列 | `createdAt`, `updatedAt` |
| `...Id` | `string`(uuid) | 外部キー・識別子 | `categoryId`, `debtId` |
| `is...` | `boolean` | 状態(現在そうであるか) | `isActive`, `isEstimated` |
| `has...` | `boolean` | 所有・付随(何かを持っているか) | `hasHeader` |
| `...Rate` | `number`(0〜1 の小数) | 割合・利率。表示は `formatAnnualRate()` でパーセントへ | `annualRate` |
| `...Ratio` | `number`(0〜1 の小数) | 進捗・消化率など、金額以外の割合 | `usageRatio`, `progressRatio` |

`...Yen` と `...Rate`/`...Ratio` は必ず小数の扱いが対になる関数を
`domain/money.ts` に持つこと(`formatX` / `parseX` / `assertX`)。
新しい単位を増やすときも同じペアを揃える。

## ドメイン用語(日本語 ↔ 識別子)

実際に DB とコードで使われている語だけを載せる。訳語を決め打ちしない。

| 日本語 | DB / TS 識別子 | 備考 |
|---|---|---|
| 借入先 | `lenderName` | `lender_name` |
| 負債の種別 | `kind: DebtKind`(`debt_kind` enum) | `revolving` / `cashing` / `installment` / `card_loan` / `consumer_finance` / `bank_loan` / `other` |
| 負債の状態 | `status: DebtStatus`(`debt_status` enum) | `active` / `paid_off` / `refinanced` / `closed` |
| 現在残高 | `currentBalanceYen` | `current_balance_yen` |
| 当初元本 | `originalPrincipalYen` | `original_principal_yen`。null 許容 |
| 最低返済額 | `minimumPaymentYen` | `minimum_payment_yen` |
| 年利 | `annualRate` | 0〜1 の小数(15% → 0.15)。ADR-008 |
| 返済日 | `paymentDay` | 1〜31 の整数(日にち番号。`DateOnly` ではない) |
| 残高時点 | `balanceAsOf` | `balance_as_of`。`currentBalanceYen` がいつ時点の値か |
| 推定値かどうか | `isEstimated` | ADR-006。true の間は確定値として見せない |
| 完済日 | `paidOffOn` | `paid_off_on`。null 許容 |
| 借り換え先 | `refinancedIntoId` | `refinanced_into_id` |
| 支出/収入の金額 | `amountYen` | 支出が負、収入が正(ADR-008) |
| 摘要・店名 | `description` | 明細の生の文字列。`merchantName` は分類後に確定した店名 |
| 取引日 | `occurredOn` | 明細が発生した日。`postedOn`(反映日)とは別概念 |
| カテゴリ | `categoryId` / `categoryName` | id は分岐に使う不変値、name は本人が改名できる表示名(ADR-016) |
| 支払方法 | `paymentMethod: PaymentMethod` | `one_time` / `revolving` / `cashing` / `installment` / `debit` / `transfer` / `unknown` |

新しい列・概念を足すときは、この表に日本語→識別子の対応を1行追加してから
コードを書く。同じ概念に2つ目の呼び方を作らない。

## 型の置き場所

| 何を置くか | 置き場所 | 例 |
|---|---|---|
| DB 行そのままの型 | `src/lib/supabase/types.ts` | 自動生成。手で編集しない |
| 計算専用の局所型(DB 行の一部だけを使う) | 計算を行う `domain/*.ts` | `domain/payoff.ts` の `Debt` |
| 画面・API が扱う「DB 行 + 派生値」の型 | 機能ディレクトリの `store.ts` / 相当ファイル | `features/transactions/store.ts` の `StoredTransaction` |
| 入力フォームの値 | その画面のファイル内(ローカル) | 他画面と共有する見込みが無ければ切り出さない |

DB 行の型を独自に再定義しない。`Database['public']['Tables']['debts']['Row']`
から `Pick` / `Omit` で派生させる(`src/lib/supabase/types.ts` を単一の正にする)。

## レイヤーの命名(データ取得・更新)

Supabase に直接触れる関数群の命名。以下の形に揃える(T-7 以降、
`features/transactions/store.ts` もこの形。以前あった `TransactionStore`
インターフェース・`SessionTransactionStore` クラスはセッション実装向けの
古い形だったため廃止した)。

| 操作 | 関数名の形 | 例 |
|---|---|---|
| 一覧取得 | `list{Plural}` | `listDebts()` |
| 1件取得 | `get{Singular}` | `getDebt(id)` |
| 新規作成 | `create{Singular}` | `createDebt(input)` |
| 更新 | `update{Singular}` | `updateDebt(id, input)` |
| 削除 | `delete{Singular}` | `deleteDebt(id)` |

Server Action(`'use server'` 関数)は、画面のファイルと同じ機能ディレクトリの
`actions.ts` に置き、上記のデータアクセス関数を呼ぶだけにする。バリデーションは
`domain/` の `assertX` / `parseX` を通す(フォームの中に条件式を増やさない)。
