import { describe, expect, it, vi } from 'vitest';

import type { ImapCredentials, MailQuery } from '@/features/import/mailbox';
import { ImapMailSource, type ImapClientLike } from '@/features/import/imap-source';

const CREDENTIALS: ImapCredentials = {
  host: 'imap.gmail.com',
  port: 993,
  user: 'me@gmail.com',
  password: 'app-password-16c',
  mailbox: 'INBOX',
};

const QUERY: MailQuery = { since: '2026-09-01' };

/** 実際の mailparser に読ませるための、最小限の RFC822 本文。 */
function rawEmail(opts: {
  messageId?: string;
  from?: string;
  subject?: string;
  date?: string;
  body: string;
}): Buffer {
  const lines = [
    `From: ${opts.from ?? 'Rakuten Card <info@mail.rakuten-card.co.jp>'}`,
    'To: me@example.com',
    `Subject: ${opts.subject ?? 'ご利用のお知らせ'}`,
    `Date: ${opts.date ?? 'Wed, 03 Sep 2026 12:34:00 +0900'}`,
    ...(opts.messageId ? [`Message-ID: <${opts.messageId}>`] : []),
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.body,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf-8');
}

/** 偽の ImapFlow。ネットワークに一切触れない。 */
function fakeClient(messages: { uid: number; source: Buffer }[]): {
  client: ImapClientLike;
  calls: { connected: boolean; loggedOut: boolean; locked: string[]; searched: unknown[] };
} {
  const calls = {
    connected: false,
    loggedOut: false,
    locked: [] as string[],
    searched: [] as unknown[],
  };
  const client: ImapClientLike = {
    async connect() {
      calls.connected = true;
    },
    async logout() {
      calls.loggedOut = true;
    },
    async getMailboxLock(path: string) {
      calls.locked.push(path);
      return { release: () => undefined };
    },
    async search(query) {
      calls.searched.push(query);
      return messages.map((m) => m.uid);
    },
    async *fetch(range) {
      for (const uid of range) {
        const found = messages.find((m) => m.uid === uid);
        if (found) yield { uid: found.uid, source: found.source };
      }
    },
  };
  return { client, calls };
}

describe('ImapMailSource', () => {
  it('search・fetch で得たメールを RawMessage に変換する', async () => {
    const raw = rawEmail({
      messageId: 'abc123@rakuten-card.co.jp',
      body: [
        'ご利用日時：2026/09/03 12:34',
        '【ご利用金額】3,500円',
        'ご利用先: ローソン渋谷',
      ].join('\n'),
    });
    const { client } = fakeClient([{ uid: 1, source: raw }]);

    const source = new ImapMailSource(CREDENTIALS, () => client);
    const messages = await source.fetch(QUERY);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: '<abc123@rakuten-card.co.jp>',
      subject: 'ご利用のお知らせ',
      receivedOn: '2026-09-03',
    });
    expect(messages[0]?.from).toContain('info@mail.rakuten-card.co.jp');
    expect(messages[0]?.body).toContain('ご利用金額');
  });

  it('接続・ロック・ログアウトのライフサイクルを踏む', async () => {
    const { client, calls } = fakeClient([]);
    const source = new ImapMailSource(CREDENTIALS, () => client);

    await source.fetch(QUERY);

    expect(calls.connected).toBe(true);
    expect(calls.loggedOut).toBe(true);
    expect(calls.locked).toEqual(['INBOX']);
  });

  it('search が空を返せば fetch を呼ばずに空配列を返す', async () => {
    const fetchSpy = vi.fn();
    const client: ImapClientLike = {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: () => undefined }),
      search: vi.fn().mockResolvedValue([]),
      fetch: fetchSpy,
    };

    const source = new ImapMailSource(CREDENTIALS, () => client);
    const messages = await source.fetch(QUERY);

    expect(messages).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('search が false を返しても落ちない(IMAP の仕様上あり得る)', async () => {
    const client: ImapClientLike = {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: () => undefined }),
      search: vi.fn().mockResolvedValue(false),
      fetch: vi.fn(),
    };

    const source = new ImapMailSource(CREDENTIALS, () => client);
    await expect(source.fetch(QUERY)).resolves.toEqual([]);
  });

  it('limit を指定すると直近分だけを fetch する', async () => {
    const { client } = fakeClient(
      [1, 2, 3, 4, 5].map((uid) => ({ uid, source: rawEmail({ body: 'x' }) })),
    );
    const fetched: number[][] = [];
    const wrapped: ImapClientLike = {
      ...client,
      fetch: (range, q, o) => {
        fetched.push(range);
        return client.fetch(range, q, o);
      },
    };

    const source = new ImapMailSource(CREDENTIALS, () => wrapped);
    await source.fetch({ ...QUERY, limit: 2 });

    expect(fetched[0]).toEqual([4, 5]);
  });

  it('Message-ID ヘッダが無ければ UID で代替する', async () => {
    const raw = rawEmail({ body: '本文のみ' });
    const { client } = fakeClient([{ uid: 42, source: raw }]);

    const source = new ImapMailSource(CREDENTIALS, () => client);
    const messages = await source.fetch(QUERY);

    expect(messages[0]?.messageId).toBe('uid-42');
  });

  it('source の無いメッセージ(取得失敗)はスキップする', async () => {
    const client: ImapClientLike = {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: () => undefined }),
      search: vi.fn().mockResolvedValue([1]),
      fetch: async function* () {
        yield { uid: 1, source: undefined };
      },
    };

    const source = new ImapMailSource(CREDENTIALS, () => client);
    await expect(source.fetch(QUERY)).resolves.toEqual([]);
  });

  it('HTML しか無いメールはタグを剥がしてテキスト化する', async () => {
    const raw = Buffer.from(
      [
        'From: Card <info@example.co.jp>',
        'To: me@example.com',
        'Subject: 通知',
        'Date: Wed, 03 Sep 2026 12:34:00 +0900',
        'Content-Type: text/html; charset=UTF-8',
        '',
        '<html><body><p>ご利用金額：3,500円</p><p>ご利用先: 例のお店</p></body></html>',
      ].join('\r\n'),
      'utf-8',
    );
    const { client } = fakeClient([{ uid: 1, source: raw }]);

    const source = new ImapMailSource(CREDENTIALS, () => client);
    const messages = await source.fetch(QUERY);

    expect(messages[0]?.body).toContain('ご利用金額');
    expect(messages[0]?.body).not.toContain('<p>');
  });

  it('connect が失敗しても logout は呼ばない(接続していないので)', async () => {
    const logoutSpy = vi.fn();
    const client: ImapClientLike = {
      connect: vi.fn().mockRejectedValue(new Error('認証に失敗しました')),
      logout: logoutSpy,
      getMailboxLock: vi.fn(),
      search: vi.fn(),
      fetch: vi.fn(),
    };

    const source = new ImapMailSource(CREDENTIALS, () => client);
    await expect(source.fetch(QUERY)).rejects.toThrow('認証に失敗しました');
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  it('取得後の処理が失敗しても logout は必ず呼ぶ', async () => {
    const logoutSpy = vi.fn().mockResolvedValue(undefined);
    const client: ImapClientLike = {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: logoutSpy,
      getMailboxLock: vi.fn().mockRejectedValue(new Error('ロック失敗')),
      search: vi.fn(),
      fetch: vi.fn(),
    };

    const source = new ImapMailSource(CREDENTIALS, () => client);
    await expect(source.fetch(QUERY)).rejects.toThrow('ロック失敗');
    expect(logoutSpy).toHaveBeenCalled();
  });
});
