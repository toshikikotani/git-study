/**
 * CSV アダプタ(ADR-007)。
 *
 * 金融機関ごとの列の並び・文字コード・日付形式・符号の違いを、この1箇所で吸収する。
 * 名前付きアダプタを先に書くと、実際に使っている機関と外れて負債になるため、
 * 本人が列を指定する「汎用マッピング」を第一級として扱う。
 *
 * ここで作った ImportAdapter は import_adapters テーブルの1行に対応する。
 */

import { parseYen } from '@/domain/money';
import type { DateOnly } from '@/lib/date';
import { parseDateOnly } from './date-parse';
import { decodeCsv, type CsvEncoding } from './encoding';
import { parseCsv } from './csv';

/** 支払方法(DB の payment_method 型のうち、CSV から判定しうるもの)。 */
export type PaymentMethod =
  'one_time' | 'revolving' | 'cashing' | 'installment' | 'debit' | 'transfer' | 'unknown';

/**
 * 単一金額列の符号規約。
 *   as_is            : 列の符号をそのまま使う
 *   expense_positive : 正の値を支出とみなして反転する(カード明細に多い)
 */
export type AmountSign = 'as_is' | 'expense_positive';

/**
 * 列の指定。ヘッダ名(`"利用日"`)または 0 始まりの列番号(`"0"`)。
 * ヘッダが無い形式でも取り込めるよう、両方を受ける。
 */
export type ColumnRef = string;

export type ImportAdapter = {
  name: string;
  encoding: CsvEncoding;
  delimiter: string;
  skipRows: number;
  hasHeader: boolean;

  dateColumn: ColumnRef;
  descriptionColumn: ColumnRef;

  /** 単一金額列。out/in の2列形式では使わない。 */
  amountColumn?: ColumnRef | undefined;
  /** 出金列(正の数で入る)。取り込み時に負へ反転する。 */
  amountOutColumn?: ColumnRef | undefined;
  /** 入金列(正の数で入る)。 */
  amountInColumn?: ColumnRef | undefined;

  balanceColumn?: ColumnRef | undefined;
  /** 「支払区分」など。リボ・キャッシングの検知に使う(FR-21)。 */
  paymentMethodColumn?: ColumnRef | undefined;

  amountSign: AmountSign;
  dateFormats: readonly string[];
};

export type ParsedTransaction = {
  /** CSV 上の行番号(1 始まり、スキップ行とヘッダを含む実ファイル上の位置)。 */
  lineNumber: number;
  occurredOn: DateOnly;
  description: string;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  balanceYen?: number | undefined;
  /** CSV の列から読めた支払方法。読めなければ 'unknown'。 */
  paymentMethod: PaymentMethod;
  /** 元の行。再解析のために transactions.raw へ入れる。 */
  raw: Record<string, string>;
};

export type RowError = {
  lineNumber: number;
  message: string;
  raw: string[];
};

export type ImportResult = {
  transactions: ParsedTransaction[];
  errors: RowError[];
  encoding: Exclude<CsvEncoding, 'auto'>;
};

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

/** 何も設定されていない状態からの出発点。UI の初期値に使う。 */
export const GENERIC_ADAPTER: ImportAdapter = {
  name: '汎用',
  encoding: 'auto',
  delimiter: ',',
  skipRows: 0,
  hasHeader: true,
  dateColumn: '0',
  descriptionColumn: '1',
  amountColumn: '2',
  amountSign: 'as_is',
  dateFormats: [],
};

/**
 * CSV のバイト列を明細に変換する。
 *
 * 1行の失敗で全体を落とさない。失敗した行は errors に積み、残りを取り込む。
 * 月に一度の「整理の儀式」で、1行のせいで全部やり直しになるのが最も萎える。
 */
export function importCsv(bytes: Uint8Array, adapter: ImportAdapter): ImportResult {
  validateAdapter(adapter);

  const { text, encoding } = decodeCsv(bytes, adapter.encoding);
  const { header, rows } = parseCsv(text, {
    delimiter: adapter.delimiter,
    skipRows: adapter.skipRows,
    hasHeader: adapter.hasHeader,
  });

  // 実ファイル上の行番号に直すための下駄。skipRows とヘッダ行の分。
  const lineOffset = adapter.skipRows + (adapter.hasHeader ? 1 : 0) + 1;

  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, index) => {
    const lineNumber = lineOffset + index;
    try {
      transactions.push(mapRow(row, header, adapter, lineNumber));
    } catch (error) {
      errors.push({
        lineNumber,
        message: error instanceof Error ? error.message : String(error),
        raw: row,
      });
    }
  });

  return { transactions, errors, encoding };
}

export function validateAdapter(adapter: ImportAdapter): void {
  const hasSingle = isSet(adapter.amountColumn);
  const hasPair = isSet(adapter.amountOutColumn) || isSet(adapter.amountInColumn);

  if (!hasSingle && !hasPair) {
    throw new AdapterError(
      '金額の列が指定されていません。単一列(amountColumn)か、出金/入金の2列を指定してください。',
    );
  }
  if (hasSingle && hasPair) {
    throw new AdapterError(
      '金額の列は単一列か出金/入金の2列のどちらかにしてください。両方は指定できません。',
    );
  }
  if (adapter.amountSign === 'expense_positive' && !hasSingle) {
    throw new AdapterError(
      'expense_positive は単一金額列のときだけ指定できます。2列形式では列で符号が決まります。',
    );
  }
  if (adapter.delimiter.length !== 1) {
    throw new AdapterError(`区切り文字は1文字である必要があります: ${adapter.delimiter}`);
  }
  if (adapter.skipRows < 0) {
    throw new AdapterError(`skipRows は 0 以上である必要があります: ${adapter.skipRows}`);
  }
}

function mapRow(
  row: string[],
  header: string[] | null,
  adapter: ImportAdapter,
  lineNumber: number,
): ParsedTransaction {
  const pick = (ref: ColumnRef | undefined): string | undefined => {
    if (!isSet(ref)) return undefined;
    const index = resolveColumnIndex(ref, header);
    return row[index];
  };

  const dateRaw = pick(adapter.dateColumn);
  if (dateRaw === undefined) {
    throw new AdapterError(`日付の列(${adapter.dateColumn})が行に存在しません`);
  }
  const occurredOn = parseDateOnly(dateRaw, adapter.dateFormats);

  const description = (pick(adapter.descriptionColumn) ?? '').trim();
  if (description === '') {
    throw new AdapterError(`摘要が空です(列 ${adapter.descriptionColumn})`);
  }

  const amountYen = readAmount(pick, adapter);
  if (amountYen === 0) {
    throw new AdapterError('金額が0円です。取り込み対象外の行の可能性があります。');
  }

  const balanceRaw = pick(adapter.balanceColumn);
  const balanceYen =
    isSet(balanceRaw) && balanceRaw.trim() !== '' ? tryParseYen(balanceRaw) : undefined;

  return {
    lineNumber,
    occurredOn,
    description,
    amountYen,
    balanceYen,
    paymentMethod: readPaymentMethod(pick(adapter.paymentMethodColumn)),
    raw: toRawRecord(row, header),
  };
}

function readAmount(
  pick: (ref: ColumnRef | undefined) => string | undefined,
  adapter: ImportAdapter,
): number {
  if (isSet(adapter.amountColumn)) {
    const raw = pick(adapter.amountColumn);
    if (!isSet(raw) || raw.trim() === '') {
      throw new AdapterError(`金額が空です(列 ${adapter.amountColumn})`);
    }
    const value = parseYen(raw);
    // カード明細は「利用金額」を正で出す。そのまま入れると支出が収入になる。
    return adapter.amountSign === 'expense_positive' ? -value : value;
  }

  const outRaw = pick(adapter.amountOutColumn);
  const inRaw = pick(adapter.amountInColumn);

  const outYen = isSet(outRaw) && outRaw.trim() !== '' ? Math.abs(parseYen(outRaw)) : 0;
  const inYen = isSet(inRaw) && inRaw.trim() !== '' ? Math.abs(parseYen(inRaw)) : 0;

  if (outYen > 0 && inYen > 0) {
    throw new AdapterError(
      `出金 ${outYen} 円と入金 ${inYen} 円が同じ行に入っています。列の指定が誤っている可能性があります。`,
    );
  }

  // 出金は支出なので負、入金は収入なので正(ADR-008)
  return outYen > 0 ? -outYen : inYen;
}

/**
 * 「支払区分」列から支払方法を読む。
 *
 * FR-21 の検知経路のひとつ。摘要側の正規表現(classification_rules)と二重に
 * 張ることで、どちらかが取りこぼしても検知できるようにする。見逃しが致命的な
 * ため、確率的な判断(AI)は使わない(ADR-010)。
 */
export function readPaymentMethod(value: string | undefined): PaymentMethod {
  if (!isSet(value)) return 'unknown';
  const text = value.replace(/\s/g, '');
  if (text === '') return 'unknown';

  if (/リボ|ﾘﾎﾞ|revolving/i.test(text)) return 'revolving';
  if (/キャッシング|ｷｬｯｼﾝｸﾞ|cashing|借入/i.test(text)) return 'cashing';

  // ボーナス払いは「一括」を含むため、一括の判定より先に見る。
  if (/ボーナス/.test(text)) return 'installment';

  // 回数は 2 以上のみ分割とする。「1回払い」を分割と誤判定すると、
  // ごく普通の買い物のたびにアラートが飛び、通知そのものが無視されるようになる。
  if (/分割|(?:[2-9]|[1-9]\d+)回払/.test(text)) return 'installment';

  if (/一括|1回払|マンスリークリア/.test(text)) return 'one_time';
  if (/デビット|debit/i.test(text)) return 'debit';
  if (/振替|振込|口座引落/.test(text)) return 'transfer';
  return 'unknown';
}

/**
 * 列指定をインデックスに解決する。
 * ヘッダ名で一致すればその位置、数字なら列番号として扱う。
 */
export function resolveColumnIndex(ref: ColumnRef, header: string[] | null): number {
  if (header) {
    const byName = header.findIndex((h) => h.trim() === ref.trim());
    if (byName >= 0) return byName;
  }

  if (/^\d+$/.test(ref.trim())) {
    return Number(ref.trim());
  }

  throw new AdapterError(
    header
      ? `列 ${JSON.stringify(ref)} が見つかりません。ヘッダ: ${header.join(' | ')}`
      : `ヘッダの無いファイルでは列を番号で指定してください: ${JSON.stringify(ref)}`,
  );
}

function toRawRecord(row: string[], header: string[] | null): Record<string, string> {
  const record: Record<string, string> = {};
  row.forEach((cell, index) => {
    const key = header?.[index]?.trim();
    record[key && key !== '' ? key : String(index)] = cell;
  });
  return record;
}

function tryParseYen(raw: string): number | undefined {
  try {
    return parseYen(raw);
  } catch {
    // 残高列は補助情報。読めなくても明細そのものは取り込む。
    return undefined;
  }
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== null;
}
