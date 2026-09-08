import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AdapterError,
  GENERIC_ADAPTER,
  guessMapping,
  importCsv,
  inspectCsv,
  readPaymentMethod,
  resolveColumnIndex,
  validateAdapter,
  type ImportAdapter,
} from '@/features/import/adapters';

/**
 * CSV 取り込みのゴールデンテスト(M2-1)。
 *
 * 実際の明細ファイルはまだ手元に無い(TASKS.md の B-2)。ここでは国内の
 * 主要フォーマットに共通する特徴 — Shift_JIS、CRLF、前置きの説明行、
 * 出金/入金の2列、桁区切り、和暦 — を代表する fixture で固めておく。
 * 実ファイルが手に入ったら匿名化して差し替える(T-2)。
 */

function fixture(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return new Uint8Array(readFileSync(path));
}

const CARD_ADAPTER: ImportAdapter = {
  name: 'カード明細',
  encoding: 'auto',
  delimiter: ',',
  skipRows: 0,
  hasHeader: true,
  dateColumn: '利用日',
  descriptionColumn: '利用店名・商品名',
  amountColumn: '利用金額',
  paymentMethodColumn: '支払方法',
  // カード明細は利用金額を正で出す。そのままでは支出が収入になる。
  amountSign: 'expense_positive',
  dateFormats: ['YYYY/MM/DD'],
};

const BANK_ADAPTER: ImportAdapter = {
  name: '銀行明細',
  encoding: 'auto',
  delimiter: ',',
  skipRows: 2, // 前置きの説明行
  hasHeader: true,
  dateColumn: '日付',
  descriptionColumn: '摘要',
  amountOutColumn: 'お支払金額',
  amountInColumn: 'お預り金額',
  balanceColumn: '残高',
  amountSign: 'as_is',
  dateFormats: ['YYYY/MM/DD'],
};

describe('カード明細(Shift_JIS / CRLF / 支出が正)', () => {
  it('Shift_JIS を自動判定して読む', () => {
    const result = importCsv(fixture('card-sjis.csv'), CARD_ADAPTER);
    expect(result.encoding).toBe('shift_jis');
    expect(result.errors).toEqual([]);
    expect(result.transactions[0]!.description).toBe('ローソン 渋谷');
  });

  it('UTF-8 と Shift_JIS で同じ結果になる', () => {
    const sjis = importCsv(fixture('card-sjis.csv'), CARD_ADAPTER);
    const utf8 = importCsv(fixture('card-utf8.csv'), CARD_ADAPTER);
    expect(sjis.encoding).toBe('shift_jis');
    expect(utf8.encoding).toBe('utf-8');
    expect(sjis.transactions).toEqual(utf8.transactions);
  });

  it('利用金額を支出(負)として取り込む', () => {
    const { transactions } = importCsv(fixture('card-utf8.csv'), CARD_ADAPTER);
    expect(transactions.map((t) => t.amountYen)).toEqual([-3500, -12800, -50000, -29800]);
  });

  it('桁区切りカンマを含む引用符付きの金額を読む', () => {
    const { transactions } = importCsv(fixture('card-utf8.csv'), CARD_ADAPTER);
    expect(transactions[1]!.amountYen).toBe(-12800);
  });

  it('支払区分からリボ・キャッシング・分割を検知する(FR-21)', () => {
    const { transactions } = importCsv(fixture('card-utf8.csv'), CARD_ADAPTER);
    expect(transactions.map((t) => t.paymentMethod)).toEqual([
      'one_time',
      'revolving',
      'cashing',
      'installment',
    ]);
  });

  it('行番号は実ファイル上の位置を指す(ヘッダを含む)', () => {
    const { transactions } = importCsv(fixture('card-utf8.csv'), CARD_ADAPTER);
    expect(transactions.map((t) => t.lineNumber)).toEqual([2, 3, 4, 5]);
  });

  it('元の行を raw に保持する(再解析のため)', () => {
    const { transactions } = importCsv(fixture('card-utf8.csv'), CARD_ADAPTER);
    expect(transactions[0]!.raw).toMatchObject({
      利用日: '2026/09/03',
      支払方法: '1回払い',
      利用金額: '3500',
    });
  });
});

describe('銀行明細(前置き行 / 出金・入金の2列 / 残高)', () => {
  it('前置きの説明行を読み飛ばしてヘッダを認識する', () => {
    const { transactions, errors } = importCsv(fixture('bank-utf8.csv'), BANK_ADAPTER);
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(3);
  });

  it('入金は正、出金は負として取り込む(ADR-008)', () => {
    const { transactions } = importCsv(fixture('bank-utf8.csv'), BANK_ADAPTER);
    expect(transactions.map((t) => t.amountYen)).toEqual([250000, -100000, -10000]);
  });

  it('残高列を読む', () => {
    const { transactions } = importCsv(fixture('bank-utf8.csv'), BANK_ADAPTER);
    expect(transactions.map((t) => t.balanceYen)).toEqual([1250000, 1150000, 1140000]);
  });

  it('支払区分の列が無ければ unknown', () => {
    const { transactions } = importCsv(fixture('bank-utf8.csv'), BANK_ADAPTER);
    expect(transactions.every((t) => t.paymentMethod === 'unknown')).toBe(true);
  });
});

describe('ヘッダ無し / タブ区切り / 和暦 / 括弧マイナス', () => {
  const adapter: ImportAdapter = {
    ...GENERIC_ADAPTER,
    name: 'ヘッダ無し',
    delimiter: '\t',
    hasHeader: false,
    dateColumn: '0',
    descriptionColumn: '1',
    amountColumn: '2',
    amountSign: 'as_is',
    dateFormats: ['和暦'],
  };

  it('列番号指定で読み、和暦を西暦に直す', () => {
    const { transactions, errors } = importCsv(fixture('no-header-tsv.tsv'), adapter);
    expect(errors).toEqual([]);
    expect(transactions[0]!.occurredOn).toBe('2026-09-08');
    expect(transactions[1]!.occurredOn).toBe('2026-09-09');
  });

  it('会計表記の括弧をマイナスとして扱う', () => {
    const { transactions } = importCsv(fixture('no-header-tsv.tsv'), adapter);
    expect(transactions.map((t) => t.amountYen)).toEqual([-1200, 800]);
  });

  it('ヘッダ無しなら行番号は1から始まる', () => {
    const { transactions } = importCsv(fixture('no-header-tsv.tsv'), adapter);
    expect(transactions.map((t) => t.lineNumber)).toEqual([1, 2]);
  });
});

describe('壊れた行の扱い', () => {
  const adapter: ImportAdapter = {
    ...GENERIC_ADAPTER,
    dateColumn: '日付',
    descriptionColumn: '摘要',
    amountColumn: '金額',
  };

  function run(csv: string) {
    return importCsv(new TextEncoder().encode(csv), adapter);
  }

  it('1行の失敗で全体を落とさない', () => {
    const result = run(
      ['日付,摘要,金額', '2026/09/03,コンビニ,-500', 'こわれた行,,,', '2026/09/04,書店,-1200'].join(
        '\n',
      ),
    );
    expect(result.transactions).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.lineNumber).toBe(3);
  });

  it('0円の行はエラーとして分ける(取り込み対象外の行のことが多い)', () => {
    const result = run(['日付,摘要,金額', '2026/09/03,調整,0'].join('\n'));
    expect(result.transactions).toEqual([]);
    expect(result.errors[0]!.message).toMatch(/0円/);
  });

  it('摘要が空の行はエラーにする', () => {
    const result = run(['日付,摘要,金額', '2026/09/03,,-500'].join('\n'));
    expect(result.errors[0]!.message).toMatch(/摘要が空/);
  });

  it('エラーには元の行を残す(本人が原因を追えるように)', () => {
    const result = run(['日付,摘要,金額', 'not-a-date,コンビニ,-500'].join('\n'));
    expect(result.errors[0]!.raw).toEqual(['not-a-date', 'コンビニ', '-500']);
  });
});

describe('validateAdapter', () => {
  it('金額の列が無ければ拒否する', () => {
    expect(() => validateAdapter({ ...GENERIC_ADAPTER, amountColumn: undefined })).toThrow(
      AdapterError,
    );
  });

  it('単一列と2列形式の併用を拒否する', () => {
    expect(() => validateAdapter({ ...GENERIC_ADAPTER, amountOutColumn: '3' })).toThrow(/どちらか/);
  });

  it('2列形式で expense_positive を指定できない', () => {
    expect(() =>
      validateAdapter({
        ...GENERIC_ADAPTER,
        amountColumn: undefined,
        amountOutColumn: '2',
        amountInColumn: '3',
        amountSign: 'expense_positive',
      }),
    ).toThrow(/単一金額列のときだけ/);
  });

  it('出金と入金が同じ行に入っていたらエラーにする(列の指定ミス)', () => {
    const result = importCsv(
      new TextEncoder().encode(['日付,摘要,出金,入金', '2026/09/03,謎,1000,2000'].join('\n')),
      {
        ...GENERIC_ADAPTER,
        amountColumn: undefined,
        amountOutColumn: '出金',
        amountInColumn: '入金',
      },
    );
    expect(result.errors[0]!.message).toMatch(/同じ行に入っています/);
  });
});

describe('resolveColumnIndex', () => {
  it('ヘッダ名で解決する', () => {
    expect(resolveColumnIndex('金額', ['日付', '摘要', '金額'])).toBe(2);
  });

  it('ヘッダ名の前後空白を無視する', () => {
    expect(resolveColumnIndex('金額', ['日付', ' 金額 '])).toBe(1);
  });

  it('数字なら列番号として扱う', () => {
    expect(resolveColumnIndex('2', null)).toBe(2);
  });

  it('ヘッダ無しで名前指定するとエラー(何が悪いか伝える)', () => {
    expect(() => resolveColumnIndex('金額', null)).toThrow(/番号で指定/);
  });

  it('存在しない列名はヘッダを添えてエラーにする', () => {
    expect(() => resolveColumnIndex('残高', ['日付', '摘要'])).toThrow(/日付 \| 摘要/);
  });
});

describe('readPaymentMethod(FR-21)', () => {
  it.each([
    ['リボ払い', 'revolving'],
    ['ﾘﾎﾞ', 'revolving'],
    ['キャッシング', 'cashing'],
    ['ｷｬｯｼﾝｸﾞ', 'cashing'],
    ['3回払い', 'installment'],
    ['12回払い', 'installment'],
    ['分割', 'installment'],
    ['ボーナス一括払', 'installment'],
    ['1回払い', 'one_time'],
    ['マンスリークリア', 'one_time'],
    ['デビット', 'debit'],
    ['口座引落', 'transfer'],
  ])('%s → %s', (input, expected) => {
    expect(readPaymentMethod(input)).toBe(expected);
  });

  it('空・未指定は unknown', () => {
    expect(readPaymentMethod(undefined)).toBe('unknown');
    expect(readPaymentMethod('  ')).toBe('unknown');
    expect(readPaymentMethod('その他')).toBe('unknown');
  });
});

describe('guessMapping — ヘッダから列を推測する(ADR-007)', () => {
  it('カード明細のヘッダを推測する', () => {
    const guess = guessMapping(['利用日', '利用店名・商品名', '利用者', '支払方法', '利用金額']);
    expect(guess.dateColumn).toBe('利用日');
    expect(guess.descriptionColumn).toBe('利用店名・商品名');
    expect(guess.amountColumn).toBe('利用金額');
    expect(guess.paymentMethodColumn).toBe('支払方法');
  });

  it('「利用金額」は支出が正の形式とみなす(カード明細の語彙)', () => {
    expect(guessMapping(['利用日', '利用店名', '利用金額']).amountSign).toBe('expense_positive');
  });

  it('「金額」だけなら符号付きとみなす', () => {
    expect(guessMapping(['日付', '摘要', '金額']).amountSign).toBe('as_is');
  });

  it('銀行明細の出金・入金2列を推測する', () => {
    const guess = guessMapping(['日付', '摘要', 'お支払金額', 'お預り金額', '残高']);
    expect(guess.amountOutColumn).toBe('お支払金額');
    expect(guess.amountInColumn).toBe('お預り金額');
    expect(guess.balanceColumn).toBe('残高');
    // 2列形式では列で符号が決まるため反転しない
    expect(guess.amountSign).toBe('as_is');
    expect(guess.amountColumn).toBeUndefined();
  });

  it('2列形式が見つかれば単一列より優先する(符号の解釈で迷わない)', () => {
    const guess = guessMapping(['日付', '摘要', '出金', '入金', '金額']);
    expect(guess.amountOutColumn).toBe('出金');
    expect(guess.amountColumn).toBeUndefined();
  });

  it('推測できない列は返さない(画面が埋める)', () => {
    const guess = guessMapping(['col1', 'col2', 'col3']);
    expect(guess.dateColumn).toBeUndefined();
    expect(guess.descriptionColumn).toBeUndefined();
  });

  it('ヘッダが無ければ空を返す', () => {
    expect(guessMapping(null)).toEqual({});
    expect(guessMapping([])).toEqual({});
  });

  it('推測した結果がそのまま取り込みに使える', () => {
    const csv = ['利用日,利用店名,利用金額', '2026/09/03,ローソン,3500'].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const header = inspectCsv(bytes).header;
    const result = importCsv(bytes, { ...GENERIC_ADAPTER, ...guessMapping(header) });
    expect(result.errors).toEqual([]);
    // 利用金額は支出が正なので、取り込み後は負になる
    expect(result.transactions[0]!.amountYen).toBe(-3500);
  });
});

describe('inspectCsv', () => {
  it('文字コードとヘッダと行数を返す', () => {
    const csv = ['日付,摘要,金額', '2026/09/03,A,-1', '2026/09/04,B,-2'].join('\n');
    const info = inspectCsv(new TextEncoder().encode(csv));
    expect(info.encoding).toBe('utf-8');
    expect(info.header).toEqual(['日付', '摘要', '金額']);
    expect(info.totalRows).toBe(2);
  });

  it('先頭5行までをサンプルとして返す', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `2026/09/${i + 1},店,-100`);
    const info = inspectCsv(new TextEncoder().encode(['日付,摘要,金額', ...rows].join('\n')));
    expect(info.sampleRows).toHaveLength(5);
    expect(info.totalRows).toBe(20);
  });
});
