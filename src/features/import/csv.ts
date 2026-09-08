/**
 * CSV のパース(FR-10)。
 *
 * 外部ライブラリを使わない理由:必要なのは RFC 4180 と、国内金融機関にありがちな
 * 前置きの説明行・BOM・CRLF だけ。依存を1つ増やすより、80行を自分で持って
 * テストで固める方が、後から本人が読める(NFR-02, 設計原則6)。
 */

export type ParseCsvOptions = {
  /** 区切り文字。タブ区切りの明細もあるため差し替えられる。 */
  delimiter?: string;
  /** 先頭で読み飛ばす行数。前置きの説明行がある形式のため。 */
  skipRows?: number;
  /** 1行目をヘッダとして扱うか。 */
  hasHeader?: boolean;
};

export type ParsedCsv = {
  /** hasHeader が false なら null。 */
  header: string[] | null;
  rows: string[][];
};

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
  }
}

/**
 * RFC 4180 準拠のパース。
 *   - 引用符内のカンマ・改行を保持する
 *   - 引用符内の "" を " として扱う
 *   - CRLF / LF / CR のいずれの改行も受ける
 *   - 末尾の空行は捨てる
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): ParsedCsv {
  const delimiter = options.delimiter ?? ',';
  if (delimiter.length !== 1) {
    throw new CsvError(`区切り文字は1文字である必要があります: ${JSON.stringify(delimiter)}`);
  }

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }

    if (char === '\r' || char === '\n') {
      endRow();
      // CRLF はまとめて1つの改行として扱う
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvError('引用符が閉じられていません。ファイルが途中で切れている可能性があります。');
  }

  // 最終行(末尾に改行が無い場合)
  if (field !== '' || row.length > 0) {
    endRow();
  }

  // 完全に空の行を落とす。末尾の空行や、区切りだけの行を明細として扱わないため。
  const meaningful = rows.filter((r) => r.some((cell) => cell.trim() !== ''));

  const skipped = meaningful.slice(options.skipRows ?? 0);

  if (options.hasHeader ?? true) {
    const [header, ...body] = skipped;
    return { header: header ?? [], rows: body };
  }

  return { header: null, rows: skipped };
}
