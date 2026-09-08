/**
 * 明細 CSV の日付表記のゆれを吸収する(ADR-007)。
 *
 * 金融機関ごとに `2026/09/08` `20260908` `26/9/8` `令和8年9月8日` と割れており、
 * 同じ本人が使う口座の中でも揃わない。ここで受け止めて DateOnly に正規化する。
 */

import { assertDateOnly, type DateOnly } from '@/lib/date';

/** アダプタが指定できる日付形式の名前。DB の import_adapters.date_formats に入る値。 */
export const DATE_FORMATS = [
  'YYYY/MM/DD', // 2026/09/08, 2026-09-08, 2026.09.08
  'YYYYMMDD', // 20260908
  'YY/MM/DD', // 26/09/08(2000年代とみなす)
  'YYYY年M月D日', // 2026年9月8日
  '和暦', // 令和8年9月8日, R8.9.8
] as const;

export type DateFormatName = (typeof DATE_FORMATS)[number];

export class DateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateParseError';
  }
}

/** 和暦の元号と、その元年に対応する西暦。 */
const ERAS: Record<string, number> = {
  令和: 2019,
  R: 2019,
  平成: 1989,
  H: 1989,
  昭和: 1926,
  S: 1926,
};

type Parser = (value: string) => DateOnly | null;

const PARSERS: Record<DateFormatName, Parser> = {
  'YYYY/MM/DD': (v) => {
    const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
    return m ? build(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  },
  YYYYMMDD: (v) => {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    return m ? build(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  },
  'YY/MM/DD': (v) => {
    const m = /^(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
    return m ? build(2000 + Number(m[1]), Number(m[2]), Number(m[3])) : null;
  },
  YYYY年M月D日: (v) => {
    const m = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日?$/.exec(v);
    return m ? build(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  },
  和暦: (v) => {
    const m =
      /^(令和|平成|昭和|R|H|S)\s*(\d{1,2}|元)\s*[年.]\s*(\d{1,2})\s*[月.]\s*(\d{1,2})日?$/.exec(v);
    if (!m) return null;
    const base = ERAS[m[1]!];
    if (base === undefined) return null;
    const eraYear = m[2] === '元' ? 1 : Number(m[2]);
    // 令和1年 = 2019年。元年が base と一致する。
    return build(base + eraYear - 1, Number(m[3]), Number(m[4]));
  },
};

/**
 * 日付文字列を DateOnly にする。
 *
 * formats を指定すると、その形式だけをその順で試す。省略すると全形式を試す。
 * アダプタで形式を絞るのは、`01/02/03` のように複数解釈できる値で
 * 誤った解釈に倒れるのを防ぐため。
 */
export function parseDateOnly(input: string, formats?: readonly string[]): DateOnly {
  const value = normalize(input);
  if (value === '') {
    throw new DateParseError('日付が空です');
  }

  const names = (formats?.length ? formats : DATE_FORMATS).filter(isKnownFormat);
  if (names.length === 0) {
    throw new DateParseError(
      `未知の日付形式が指定されています: ${formats?.join(', ')}。` +
        `使えるのは ${DATE_FORMATS.join(' / ')} です。`,
    );
  }

  for (const name of names) {
    const parsed = PARSERS[name](value);
    if (parsed) return parsed;
  }

  throw new DateParseError(
    `日付として解釈できません: ${JSON.stringify(input)}(試した形式: ${names.join(', ')})`,
  );
}

export function isKnownFormat(name: string): name is DateFormatName {
  return (DATE_FORMATS as readonly string[]).includes(name);
}

/** 全角数字・全角記号・空白を正規化する。 */
function normalize(input: string): string {
  return input
    .replace(/[０-９／．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .trim();
}

function build(year: number, month: number, day: number): DateOnly | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 2月30日のような存在しない日付を弾く
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1) return null;
  if (probe.getUTCDate() !== day) return null;
  return assertDateOnly(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}
