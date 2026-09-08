/**
 * CSV の文字コード判定とデコード(ADR-007)。
 *
 * 国内の金融機関が出す明細 CSV は Shift_JIS が依然として多い。UTF-8 として
 * 読むと店名が化け、分類も検索も効かなくなる。しかも化けても処理は最後まで
 * 通ってしまうため、気づくのが遅れる。ここで確実に判定する。
 */

export type CsvEncoding = 'auto' | 'utf-8' | 'shift_jis' | 'euc-jp';

export type DecodeResult = {
  text: string;
  /** 実際に使ったエンコーディング。'auto' は返らない。 */
  encoding: Exclude<CsvEncoding, 'auto'>;
  /** BOM を除去したか。 */
  hadBom: boolean;
};

const UTF8_BOM = [0xef, 0xbb, 0xbf];

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

/**
 * バイト列を文字列にする。
 *
 * 'auto' の判定順:
 *   1. UTF-8 BOM があれば UTF-8 で確定
 *   2. UTF-8 として厳密(fatal)にデコードできれば UTF-8
 *   3. できなければ Shift_JIS
 *
 * UTF-8 の厳密デコードは不正なバイト列で必ず例外になるため、判定が決定的になる。
 * Shift_JIS のバイト列はほぼ確実に UTF-8 として不正になるので、この順序で足りる。
 */
export function decodeCsv(bytes: Uint8Array, encoding: CsvEncoding = 'auto'): DecodeResult {
  const hadBom = bytes.length >= 3 && UTF8_BOM.every((b, i) => bytes[i] === b);
  const body = hadBom ? bytes.subarray(3) : bytes;

  if (encoding !== 'auto') {
    return { text: decodeWith(body, encoding), encoding, hadBom };
  }

  if (hadBom) {
    return { text: decodeWith(body, 'utf-8'), encoding: 'utf-8', hadBom };
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(body),
      encoding: 'utf-8',
      hadBom,
    };
  } catch {
    return { text: decodeWith(body, 'shift_jis'), encoding: 'shift_jis', hadBom };
  }
}

function decodeWith(bytes: Uint8Array, encoding: Exclude<CsvEncoding, 'auto'>): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new DecodeError(`${encoding} としてデコードできませんでした: ${detail}`);
  }
}
