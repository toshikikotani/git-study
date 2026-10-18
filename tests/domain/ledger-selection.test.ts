import { describe, expect, it } from 'vitest';

import { buildLedgerSelectionText } from '@/domain/ledger-selection';
import { MAX_YEN } from '@/domain/money';
import { ledgerSplit, ledgerTx } from '../helpers/ledger';

describe('buildLedgerSelectionText', () => {
  it('選んだ順に日付・店名・支店・方向・金額・状態を示し、混在する合計を作らない', () => {
    const text = buildLedgerSelectionText([
      ledgerTx({ id: 'dinner', label: '夕食', branchName: '駅前店', amountYen: -1200 }),
      ledgerTx({ id: 'salary', label: '給与', amountYen: 150000 }),
      ledgerTx({ id: 'future', label: '予定の買い物', amountYen: -3000, status: 'scheduled' }),
    ]);
    expect(text).toBe(
      [
        '選択した明細（3件）',
        '',
        '・2026/09/10 夕食 駅前店 支出 1,200円［実績］',
        '・2026/09/10 給与 入金 150,000円［実績］',
        '・2026/09/10 予定の買い物 支出 3,000円［予定］',
      ].join('\n'),
    );
    expect(text).not.toContain('合計');
  });

  it('返金・振替・対象外・特別費・入力待ち・確認待ちの状態を失わない', () => {
    const text = buildLedgerSelectionText([
      ledgerTx({ id: 'refund', label: '返品', amountYen: 500, kind: 'refund' }),
      ledgerTx({ id: 'outbound', label: '銀行', amountYen: -1000, isTransfer: true }),
      ledgerTx({ id: 'inbound', label: '銀行', amountYen: 1000, isTransfer: true }),
      ledgerTx({ id: 'ignored', label: '対象外の買い物', reviewStatus: 'ignored' }),
      ledgerTx({ id: 'special', label: '特別な買い物', kind: 'special' }),
      ledgerTx({ id: 'waiting', label: 'レシート', amountYen: 0, needsInput: true }),
      ledgerTx({ id: 'pending', label: '確認する買い物', reviewStatus: 'pending' }),
    ]);
    expect(text).toContain('返品 入金 500円［実績・返金］');
    expect(text).toContain('銀行 出金 1,000円［実績・振替］');
    expect(text).toContain('銀行 入金 1,000円［実績・振替］');
    expect(text).toContain('対象外の買い物 支出 1,000円［実績・対象外］');
    expect(text).toContain('特別な買い物 支出 1,000円［実績・特別費］');
    expect(text).toContain('金額未確定（記録額 0円）［実績・入力待ち］');
    expect(text).toContain('確認する買い物 支出 1,000円［実績・確認待ち］');
  });

  it('入力待ちに数値があっても確定した金額と区別する', () => {
    expect(
      buildLedgerSelectionText([ledgerTx({ id: 'waiting', amountYen: -300, needsInput: true })]),
    ).toContain('記録額 支出 300円［実績・入力待ち］');
  });

  it('親IDの重複やカテゴリ分割を二重に数えず、余分な私的情報を出さない', () => {
    const parent = ledgerTx({
      id: 'private-id',
      label: '買い物',
      amountYen: -3000,
      memo: '秘密のメモ',
      accountId: 'private-account',
      description: '秘密の摘要',
      thumbnailUrl: 'https://private.example/receipt',
      splits: [ledgerSplit({ genreId: null, amountYen: -1000, note: '秘密の品目' })],
    });
    const text = buildLedgerSelectionText([parent, { ...parent, amountYen: -1000 }]);
    expect(text).toContain('選択した明細（1件）');
    expect(text).toContain('支出 3,000円');
    expect(text).not.toMatch(/private|秘密|1,000/);
    expect(parent.splits).toHaveLength(1);
  });

  it('店名・支店の改行や制御文字を文面の構造に使わない', () => {
    const text = buildLedgerSelectionText([
      ledgerTx({ id: 'shop', label: ' 店\n名\t\u0000 ', branchName: '\r駅前\u202e店\u2028 ' }),
      ledgerTx({ id: 'blank', label: '\n\t', branchName: '\u200b' }),
    ]);
    expect(text).toContain('店 名 駅前 店 支出');
    expect(text).toContain('名称なし 支出');
    expect(text.split('\n')).toHaveLength(4);
    expect(text.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  it('集計しないため各明細が有効なら合計が上限を超えてもコピーできる', () => {
    const text = buildLedgerSelectionText([
      ledgerTx({ id: 'large-a', amountYen: -MAX_YEN }),
      ledgerTx({ id: 'large-b', amountYen: -MAX_YEN }),
    ]);
    expect(text).toContain('選択した明細（2件）');
    expect(text.match(/1,000,000,000,000円/g)).toHaveLength(2);
  });

  it.each([NaN, Infinity, -0.5, MAX_YEN + 1])('不正な金額%sを黙ってコピーしない', (amountYen) => {
    expect(() => buildLedgerSelectionText([ledgerTx({ id: 'bad', amountYen })])).toThrow();
  });

  it('空の選択・不明なID・不正な日付は明細を確認させる', () => {
    expect(() => buildLedgerSelectionText([])).toThrow('明細を選んでください');
    expect(() => buildLedgerSelectionText([ledgerTx({ id: ' ' })])).toThrow('選び直してください');
    expect(() =>
      buildLedgerSelectionText([ledgerTx({ id: 'bad-date', occurredOn: '2026/09/10' })]),
    ).toThrow('YYYY-MM-DD');
  });
});
