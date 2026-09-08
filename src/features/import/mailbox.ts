/**
 * 通知メールの取得(FR-10 の自動経路、仕様書 9.2)。
 *
 * ── なぜ IMAP + アプリパスワードか ──────────────────────────
 * Gmail は 2025年5月に通常パスワードでの third-party アクセスを止め、
 * 現在は OAuth 2.0 かアプリパスワード(16文字)のいずれかが要る。
 * 本システムは本人専用のシングルユーザーで、同意画面を出す相手が
 * 自分しかいない。OAuth はリフレッシュトークンの取得と保管という
 * 手順が増えるだけで、得るものがない。
 * アプリパスワードは発行も失効も本人の画面で完結し、権限が
 * メールに限定される。環境変数2つで済む(ADR-018)。
 *
 * ── ここを抽象にしている理由 ────────────────────────────────
 * ネットワークに出る部分だけを MailSource に閉じ込め、
 * 「取得 → 解析 → 分類 → 重複排除」の判断はすべて純粋な関数に置く。
 * 資格情報が無くても、取り込みの挙動はテストできる。
 */

import type { DateOnly } from '@/lib/date';

/** 取得した1通。解析に必要な部分だけを持つ。 */
export type RawMessage = {
  /** 冪等性のための外部一意キー。transactions.source_ref に入る。 */
  messageId: string;
  from: string;
  subject: string;
  receivedOn: DateOnly;
  body: string;
};

export type MailQuery = {
  /** この日以降に届いたものだけを対象にする。 */
  since: DateOnly;
  /**
   * 対象とする差出人。空なら全件。
   * カード会社を絞ることで、無関係なメールを解析にかけずに済む。
   */
  fromAddresses?: readonly string[] | undefined;
  /** 一度に読む上限。初回実行で受信箱を全部読まないための歯止め。 */
  limit?: number | undefined;
};

export interface MailSource {
  fetch(query: MailQuery): Promise<RawMessage[]>;
}

/**
 * 通知メールを送ってくる差出人の初期値。
 *
 * ここに無い発行元を使っていても、本人が設定で足せる
 * (app_settings.gmail_from_addresses)。空にすれば全件を対象にできるが、
 * 無関係なメールまで解析にかかるため既定では絞る。
 */
export const DEFAULT_CARD_SENDERS: readonly string[] = [
  'rakuten-card.co.jp',
  'smbc-card.com',
  'jcb.co.jp',
  'aeon.co.jp',
  'saisoncard.co.jp',
  'cr.mufg.jp',
  'orico.co.jp',
  'epos-card.co.jp',
  'paypay-card.co.jp',
  'view.co.jp',
];

/**
 * IMAP 実装。
 *
 * サーバへ出る唯一の場所。資格情報を受け取り、条件に合うメールを返すだけで、
 * 解析も分類もしない。ここが差し替えられるので、テストは偽の実装を渡せる。
 *
 * 実行はサーバ側(GitHub Actions が叩く Route Handler)に限る。
 * 資格情報がブラウザへ渡ることは無い(NFR-04)。
 */
export type ImapCredentials = {
  host: string;
  port: number;
  user: string;
  /** Gmail のアプリパスワード(16文字)。通常のパスワードでは接続できない。 */
  password: string;
  mailbox: string;
};

export const GMAIL_IMAP: Pick<ImapCredentials, 'host' | 'port' | 'mailbox'> = {
  host: 'imap.gmail.com',
  port: 993,
  mailbox: 'INBOX',
};

/**
 * 取得対象を IMAP の検索条件に組み立てる。
 *
 * 差出人が複数あるときは OR を入れ子にする必要がある(IMAP の SEARCH は
 * 二項演算しか取らない)。ここを間違えると1社分しか拾えないため、
 * 組み立てだけを関数に切り出してテストする。
 */
export function buildImapSearch(query: MailQuery): Record<string, unknown> {
  const since = new Date(`${query.since}T00:00:00Z`);
  const senders = query.fromAddresses ?? [];

  if (senders.length === 0) {
    return { since };
  }
  if (senders.length === 1) {
    return { since, from: senders[0] };
  }

  // OR(a, OR(b, OR(c, d))) の形に畳む
  return {
    since,
    or: senders.reduce<Record<string, unknown>[]>((acc, sender) => {
      if (acc.length < 2) return [...acc, { from: sender }];
      return [acc[0]!, { or: [acc[1]!, { from: sender }] }];
    }, []),
  };
}
