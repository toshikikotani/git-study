import { describe, expect, it } from 'vitest';

import { parseNotificationEmail } from '@/features/import/email';
import { StaticMailSource, syncFromMailbox } from '@/features/import/mail-sync';
import { buildImapSearch, type RawMessage } from '@/features/import/mailbox';
import type { ClassificationRule } from '@/features/classification/rules';

/**
 * カード利用通知メールの解析(FR-10, 仕様書 9.2)。
 *
 * 発行元ごとのテンプレートではなくラベルの語彙で解析しているため、
 * ここでは実在する各社の書式に共通する形をなぞって検証する。
 */

const RAKUTEN = `
楽天カードご利用のお知らせ

カード利用日: 2026/09/03
ご利用先: ローソン渋谷
ご利用金額: 3,500円
支払方法: 1回払い
`;

const SMBC = `
三井住友カードご利用のお知らせ

ご利用日時：2026/09/05 12:34
ご利用金額：12,800円
ご利用先：ＡＭＡＺＯＮ．ＣＯ．ＪＰ
お支払方法：リボ払い
`;

const JCB_BRACKETS = `
【ご利用日時】2026/09/06 21:05
【ご利用金額】50,000円
【ご利用先】ATM キャッシング
【お支払区分】キャッシング
`;

const MULTIPLE = `
ご利用明細

ご利用日: 2026/09/03
ご利用先: ローソン
ご利用金額: 500円

ご利用日: 2026/09/04
ご利用先: セブンイレブン
ご利用金額: 800円
`;

describe('parseNotificationEmail — 発行元ごとの書式', () => {
  it('「ラベル: 値」形式を読む', () => {
    const { transactions } = parseNotificationEmail(RAKUTEN);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      occurredOn: '2026-09-03',
      description: 'ローソン渋谷',
      amountYen: -3500,
      paymentMethod: 'one_time',
    });
  });

  it('全角コロンと日時付きの形式を読む', () => {
    const { transactions } = parseNotificationEmail(SMBC);
    expect(transactions[0]).toMatchObject({
      occurredOn: '2026-09-05',
      amountYen: -12800,
      paymentMethod: 'revolving',
    });
  });

  it('【ラベル】値 の形式を読む', () => {
    const { transactions } = parseNotificationEmail(JCB_BRACKETS);
    expect(transactions[0]).toMatchObject({
      occurredOn: '2026-09-06',
      amountYen: -50000,
      paymentMethod: 'cashing',
    });
  });

  it('1通に複数の明細が並ぶ形式を分けて読む', () => {
    const { transactions } = parseNotificationEmail(MULTIPLE);
    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.amountYen)).toEqual([-500, -800]);
    expect(transactions.map((t) => t.description)).toEqual(['ローソン', 'セブンイレブン']);
  });
});

describe('parseNotificationEmail — 符号と欠落', () => {
  it('利用通知は必ず支出(負)として扱う', () => {
    const { transactions } = parseNotificationEmail(RAKUTEN);
    expect(transactions[0]!.amountYen).toBeLessThan(0);
  });

  it('店名が読めなくても、日付と金額があれば取り込む', () => {
    const { transactions } = parseNotificationEmail('ご利用日: 2026/09/03\nご利用金額: 1,200円');
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.description).toBe('(店名不明)');
  });

  it('日付が無ければ飛ばし、理由を残す', () => {
    const result = parseNotificationEmail('ご利用金額: 1,200円\nご利用先: 書店');
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/日付が読み取れない/);
  });

  it('金額が無ければ飛ばし、理由を残す', () => {
    const result = parseNotificationEmail('ご利用日: 2026/09/03\nご利用先: 書店');
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/金額が読み取れない/);
  });

  it('関係のないメールは何も返さず、理由を残す', () => {
    const result = parseNotificationEmail('キャンペーンのお知らせ\n今なら還元率アップ！');
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });

  it('解釈できない日付は理由を残して飛ばす', () => {
    const result = parseNotificationEmail('ご利用日: 先週の火曜日\nご利用金額: 1,200円');
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/解釈できません/);
  });
});

describe('buildImapSearch', () => {
  it('差出人の指定が無ければ日付だけで絞る', () => {
    expect(buildImapSearch({ since: '2026-09-01' })).toEqual({
      since: new Date('2026-09-01T00:00:00Z'),
    });
  });

  it('差出人が1件ならそのまま渡す', () => {
    const search = buildImapSearch({ since: '2026-09-01', fromAddresses: ['a.example'] });
    expect(search['from']).toBe('a.example');
  });

  it('差出人が複数なら OR を入れ子にする(1社しか拾えない事故を防ぐ)', () => {
    const search = buildImapSearch({
      since: '2026-09-01',
      fromAddresses: ['a.example', 'b.example', 'c.example'],
    });
    expect(search['or']).toEqual([
      { from: 'a.example' },
      { or: [{ from: 'b.example' }, { from: 'c.example' }] },
    ]);
  });
});

describe('syncFromMailbox — 自動取り込み', () => {
  const RULES: ClassificationRule[] = [
    {
      id: 'd1',
      name: 'リボ払いの検知',
      priority: 1,
      matchType: 'regex',
      pattern: '(リボ|ﾘﾎﾞ)',
      setPaymentMethod: 'revolving',
      isActive: true,
    },
  ];

  const messages: RawMessage[] = [
    {
      messageId: 'm1',
      from: 'info@rakuten-card.co.jp',
      subject: 'カード利用のお知らせ',
      receivedOn: '2026-09-03',
      body: RAKUTEN,
    },
    {
      messageId: 'm2',
      from: 'info@smbc-card.com',
      subject: 'カード利用のお知らせ',
      receivedOn: '2026-09-05',
      body: SMBC,
    },
    {
      messageId: 'm3',
      from: 'news@example.com',
      subject: 'メールマガジン',
      receivedOn: '2026-09-05',
      body: '今週のおすすめ',
    },
  ];

  const base = {
    source: new StaticMailSource(messages),
    rules: RULES,
    knownMessageIds: new Set<string>(),
    knownFingerprints: new Set<string>(),
    batchId: 'b1',
  };

  it('通知メールから明細を作る', async () => {
    const result = await syncFromMailbox({ ...base, query: { since: '2026-09-01' } });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map((t) => t.amountYen)).toEqual([-3500, -12800]);
  });

  it('差出人を絞ると無関係なメールを解析にかけない', async () => {
    const result = await syncFromMailbox({
      ...base,
      query: { since: '2026-09-01', fromAddresses: ['rakuten-card.co.jp'] },
    });
    expect(result.scannedMessageCount).toBe(1);
    expect(result.transactions).toHaveLength(1);
  });

  it('リボ払いを検知する(FR-21 の主経路)', async () => {
    const result = await syncFromMailbox({ ...base, query: { since: '2026-09-01' } });
    const revolving = result.transactions.filter((t) => t.paymentMethod === 'revolving');
    expect(revolving).toHaveLength(1);
    expect(revolving[0]!.amountYen).toBe(-12800);
  });

  it('読み終えたメールは二度読まない(再実行しても増えない)', async () => {
    const first = await syncFromMailbox({ ...base, query: { since: '2026-09-01' } });
    const second = await syncFromMailbox({
      ...base,
      query: { since: '2026-09-01' },
      knownMessageIds: new Set(first.processedMessageIds),
    });
    expect(second.transactions).toEqual([]);
  });

  it('CSV から既に入っている明細は取り込まない(支出が倍にならない)', async () => {
    const first = await syncFromMailbox({ ...base, query: { since: '2026-09-01' } });
    const second = await syncFromMailbox({
      ...base,
      query: { since: '2026-09-01' },
      knownFingerprints: new Set(first.transactions.map((t) => t.fingerprint)),
    });
    expect(second.transactions).toEqual([]);
    expect(second.duplicateCount).toBe(2);
  });

  it('解析できなかったメールは理由付きで記録する(黙って捨てない)', async () => {
    const result = await syncFromMailbox({ ...base, query: { since: '2026-09-01' } });
    expect(result.warnings.some((w) => w.messageId === 'm3')).toBe(true);
  });

  it('取得日より前のメールは対象にしない', async () => {
    const result = await syncFromMailbox({ ...base, query: { since: '2026-09-05' } });
    expect(result.scannedMessageCount).toBe(2);
  });

  it('分類できない明細は本人の確認へ回す(FR-12)', async () => {
    const result = await syncFromMailbox({ ...base, query: { since: '2026-09-01' } });
    expect(result.transactions.every((t) => t.reviewStatus === 'pending')).toBe(true);
  });
});
