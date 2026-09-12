import { describe, expect, it } from 'vitest';

import { parseStatementEmail } from '@/features/import/statement-email';

const RAKUTEN_STATEMENT = `
楽天カードご利用金額のお知らせ

いつも楽天カードをご利用いただきありがとうございます。
ご利用期間：2026年8月11日〜2026年9月10日
今回のご請求金額 45,678円
`;

const NO_PERIOD_STATEMENT = `
お支払い金額のお知らせ

お支払い金額: 12,345円
`;

const UNREADABLE = `
メールマガジン

今週のおすすめ商品をご紹介します。
`;

describe('parseStatementEmail(FR-18, M6-4)', () => {
  it('金額と期間を読み取る', () => {
    const { statement, warnings } = parseStatementEmail(RAKUTEN_STATEMENT);
    expect(statement).toEqual({
      totalYen: 45678,
      periodStartOn: '2026-08-11',
      periodEndOn: '2026-09-10',
    });
    expect(warnings).toEqual([]);
  });

  it('期間の記載が無くても金額だけは読み取る', () => {
    const { statement } = parseStatementEmail(NO_PERIOD_STATEMENT);
    expect(statement).toEqual({
      totalYen: 12345,
      periodStartOn: null,
      periodEndOn: null,
    });
  });

  it('金額を読み取れなければ null を返し、警告を残す(NFR-06)', () => {
    const { statement, warnings } = parseStatementEmail(UNREADABLE);
    expect(statement).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });
});
