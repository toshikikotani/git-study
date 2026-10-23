# iPhone 版(Expo)

iPhone 専用のアプリ(`mobile/`)。Web 版はそのまま残し、iPhone 版は同じサーバー・同じ計算を使う
(ADR-132)。Mac は要らない(ビルドと App Store への提出は Expo のクラウド)。

## いまできること(段階1)

- ログイン(Web 版と同じメールアドレスとパスワード。ログインは端末に残る)
- 今日:今日の目安・明日からの目安・今日やること・今期の見通し・今日の記録。前に読んだ値をすぐ出して、
  うしろで新しくする(引っぱっても新しくなる)
- 記録する(右下の＋):
  - 「レシートを撮る」「写真から」:iPhone のカメラ・写真で選び、読み取ってそのまま記録する(LINE の
    レシートと同じ。夜の答え合わせで確かめる)。結果に「取り消す」
  - 手で入れる:金額・カテゴリ(よく使う順)・お店やメモ・今日か昨日。保存は右上
- 設定:ログアウト、Web 版を開く

答え合わせ・入力待ちのレシート・給料日・明細・分析は、いまは Web 版を開く(次の段階で iPhone 版に作る)。

## しくみ

- 画面は `mobile/src/app/`(Expo Router)。数字はサーバーの `/api/mobile/*` が Web 版と同じ関数で
  計算して返す(`src/features/mobile/`)。受け渡しの形は `src/features/mobile/contract.ts`。
- ログインの証明:アプリは Supabase にログインし、そのアクセストークンを `Authorization: Bearer` で送る。
  サーバーは関所(`proxy.ts`)と入口(`src/lib/supabase/bearer-session.ts`)の両方で Supabase に確かめ、
  その処理のあいだだけ本人のセッション(RLS のまま)で動く。Web の cookie のセッションには触らない。
- 共通のコード:`mobile/` から `@/…` で読むのはリポジトリの `src/`(金額の書き方 `@/domain/money`、
  約束 `@/features/mobile/contract`)。`src/` のうち、外の npm パッケージを読まないものだけを読む。

## 設定(公開してよい値)

`mobile/.env.example` の3つ。Expo のプロジェクトの Environment variables に同じ名前で入れる。

| 名前 | 値 |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Web 版の `NEXT_PUBLIC_SUPABASE_URL` と同じ |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Web 版の `NEXT_PUBLIC_SUPABASE_ANON_KEY` と同じ |
| `EXPO_PUBLIC_API_BASE_URL` | Web 版(Vercel)の URL。例 `https://….vercel.app` |

## iPhone で試す

1. Expo のアカウントを作り(無料)、アクセストークンを発行する。この作業環境の設定(環境メニュー →
   Edit → Network secrets か環境変数)に `EXPO_TOKEN` として入れる(チャットには貼らない)。
2. Expo のプロジェクトの Environment variables に、上の3つを入れる。
3. iPhone に「Expo Go」(App Store・無料)を入れ、同じ Expo アカウントでログインしておく。
4. こちらで `eas init`(プロジェクトを作る)と `eas update`(試す版を上げる)をして、試す画面の
   リンク(QR コード)を渡す。

Expo Go で開けない機能(iPhone の通知など)や、アイコン・名前の見え方は、TestFlight で確かめる。
TestFlight には Apple Developer Program(有料、本人名義)の登録が要る。

## 確かめ方(手元)

```sh
cd mobile
npm ci
npx tsc --noEmit                       # 型
npx expo export --platform ios          # iPhone 用にまとめられるか
npx expo-doctor                         # 設定の点検
```

CI の「mobile (typecheck / iOS bundle)」も同じことを見る。
