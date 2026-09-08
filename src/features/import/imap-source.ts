/**
 * IMAP 経由の MailSource 実装(M2-7b、ADR-018)。
 *
 * ネットワークに出るのはこのファイルだけ。検索条件の組み立ては
 * mailbox.ts の buildImapSearch に、本文の抽出は mailparser に任せ、
 * ここでは接続の開始・ロック・後始末というライフサイクルだけを見る。
 *
 * ── なぜ imapflow を直接使わず ImapClientLike を挟むのか ──────
 * ImapFlow クラスをそのまま型に使うと、テストのたびに実サーバへ
 * 繋ぐか、クラス全体をモックする羽目になる。使っているメソッド
 * (connect / getMailboxLock / search / fetch / logout)だけを
 * 抜き出したインターフェースにしておけば、テストは資格情報を
 * 使わない偽実装を渡すだけで済む(mailbox.ts の MailSource と同じ考え方)。
 *
 * ── なぜ mailparser を挟むのか ─────────────────────────────
 * imapflow は生のメッセージ(RFC822)しか返さない。カード会社の通知は
 * multipart/base64/quoted-printable が混じり、自前でデコードすると
 * 文字化けの温床になる。mailparser(imapflow と同じ作者)にデコードを
 * 任せ、ここでは崩れないプレーンテキストを取り出すことだけを担う。
 *
 * ── HTML しか無いメールへの対応 ─────────────────────────────
 * text パートが無ければ html を簡易的にテキスト化する。凝ったパーサは
 * 要らない――後段のラベル辞書・AI 救済のどちらも改行区切りのテキストを
 * 前提にしているので、タグを剥がして改行を残すだけで足りる。
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';

import { todayJst } from '@/lib/date';
import { buildImapSearch } from './mailbox';
import type { ImapCredentials, MailQuery, MailSource, RawMessage } from './mailbox';

/** ImapFlow のうち、この実装が実際に使う部分だけを切り出した形。 */
export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(
    query: Record<string, unknown>,
    options?: { uid: boolean },
  ): Promise<number[] | false | undefined>;
  fetch(
    range: number[],
    query: { source: boolean },
    options?: { uid: boolean },
  ): AsyncGenerator<{ uid: number; source?: Buffer | undefined }>;
}

function defaultClientFactory(credentials: ImapCredentials): ImapClientLike {
  return new ImapFlow({
    host: credentials.host,
    port: credentials.port,
    secure: true,
    auth: { user: credentials.user, pass: credentials.password },
    logger: false,
  });
}

export class ImapMailSource implements MailSource {
  constructor(
    private readonly credentials: ImapCredentials,
    private readonly clientFactory: (
      credentials: ImapCredentials,
    ) => ImapClientLike = defaultClientFactory,
  ) {}

  async fetch(query: MailQuery): Promise<RawMessage[]> {
    const client = this.clientFactory(this.credentials);
    await client.connect();
    try {
      return await this.fetchFromOpenMailbox(client, query);
    } finally {
      // ログアウト自体が失敗しても、取得済みの結果を握りつぶしたくないので
      // ここでは投げない。接続はサーバー側のタイムアウトでいずれ閉じる。
      await client.logout().catch(() => undefined);
    }
  }

  private async fetchFromOpenMailbox(
    client: ImapClientLike,
    query: MailQuery,
  ): Promise<RawMessage[]> {
    const lock = await client.getMailboxLock(this.credentials.mailbox);
    try {
      const uids = await client.search(buildImapSearch(query), { uid: true });
      if (!uids || uids.length === 0) return [];

      // UID SEARCH の結果は古い→新しい順に並ぶ。limit があれば直近分だけに絞る。
      const target = query.limit === undefined ? uids : uids.slice(-query.limit);

      const messages: RawMessage[] = [];
      for await (const message of client.fetch(target, { source: true }, { uid: true })) {
        if (message.source === undefined) continue;
        messages.push(await toRawMessage(message.source, message.uid));
      }
      return messages;
    } finally {
      lock.release();
    }
  }
}

async function toRawMessage(source: Buffer, uid: number): Promise<RawMessage> {
  const parsed = await simpleParser(source);
  return {
    // Message-ID ヘッダが無いメールは稀だが有り得るため、UID で代替する。
    // 同一メールボックス内では一意なので冪等性は保てる。
    messageId: parsed.messageId ?? `uid-${uid}`,
    from: parsed.from?.text ?? '',
    subject: parsed.subject ?? '',
    receivedOn: todayJst(parsed.date ?? new Date()),
    body: extractBody(parsed),
  };
}

function extractBody(parsed: ParsedMail): string {
  if (typeof parsed.text === 'string' && parsed.text.trim() !== '') return parsed.text;
  if (typeof parsed.html === 'string') return stripHtml(parsed.html);
  return '';
}

/** ラベル辞書・AI 救済のどちらも改行区切りのテキストを前提にするための最小限の変換。 */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
