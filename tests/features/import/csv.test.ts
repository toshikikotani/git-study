import { describe, expect, it } from 'vitest';

import { CsvError, parseCsv } from '@/features/import/csv';
import { DateParseError, parseDateOnly } from '@/features/import/date-parse';
import { decodeCsv } from '@/features/import/encoding';

describe('parseCsv', () => {
  it('引用符内のカンマを field の一部として保持する', () => {
    const { rows } = parseCsv('a,b\n"1,234",コンビニ', { hasHeader: true });
    expect(rows[0]).toEqual(['1,234', 'コンビニ']);
  });

  it('引用符内の "" を " として扱う', () => {
    const { rows } = parseCsv('a\n"彼は""そう""と言った"', { hasHeader: true });
    expect(rows[0]).toEqual(['彼は"そう"と言った']);
  });

  it('引用符内の改行を保持する', () => {
    const { rows } = parseCsv('a,b\n"1行目\n2行目",x', { hasHeader: true });
    expect(rows[0]).toEqual(['1行目\n2行目', 'x']);
  });

  it('CRLF / LF / CR のいずれも改行として扱う', () => {
    expect(parseCsv('h\r\na\r\nb', { hasHeader: true }).rows).toEqual([['a'], ['b']]);
    expect(parseCsv('h\na\nb', { hasHeader: true }).rows).toEqual([['a'], ['b']]);
    expect(parseCsv('h\ra\rb', { hasHeader: true }).rows).toEqual([['a'], ['b']]);
  });

  it('末尾に改行が無い最終行も取りこぼさない', () => {
    const { rows } = parseCsv('h\na,b', { hasHeader: true });
    expect(rows).toEqual([['a', 'b']]);
  });

  it('空行を落とす(末尾の余分な改行で空の明細を作らない)', () => {
    const { rows } = parseCsv('h\na\n\n\nb\n', { hasHeader: true });
    expect(rows).toEqual([['a'], ['b']]);
  });

  it('skipRows で前置きの説明行を飛ばす', () => {
    const result = parseCsv('説明1\n説明2\n日付,金額\n2026/09/03,-500', {
      skipRows: 2,
      hasHeader: true,
    });
    expect(result.header).toEqual(['日付', '金額']);
    expect(result.rows).toEqual([['2026/09/03', '-500']]);
  });

  it('hasHeader: false ならヘッダを取らない', () => {
    const result = parseCsv('a,b\nc,d', { hasHeader: false });
    expect(result.header).toBeNull();
    expect(result.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('区切り文字を差し替えられる(タブ区切りの明細)', () => {
    const { rows } = parseCsv('h1\th2\na\tb', { delimiter: '\t', hasHeader: true });
    expect(rows[0]).toEqual(['a', 'b']);
  });

  it('閉じられていない引用符を、途中で切れたファイルとしてエラーにする', () => {
    expect(() => parseCsv('h\n"開いたまま', { hasHeader: true })).toThrow(CsvError);
  });

  it('区切り文字が1文字でなければエラー', () => {
    expect(() => parseCsv('a,b', { delimiter: '::' })).toThrow(/1文字/);
  });
});

describe('decodeCsv', () => {
  const sjisKonbini = new Uint8Array([0x83, 0x8d, 0x81, 0x5b, 0x83, 0x5c, 0x83, 0x93]); // ローソン

  it('Shift_JIS を自動判定する', () => {
    const result = decodeCsv(sjisKonbini);
    expect(result.encoding).toBe('shift_jis');
    expect(result.text).toBe('ローソン');
  });

  it('UTF-8 を自動判定する', () => {
    const result = decodeCsv(new TextEncoder().encode('ローソン'));
    expect(result.encoding).toBe('utf-8');
    expect(result.text).toBe('ローソン');
  });

  it('UTF-8 BOM を除去する(先頭列名に BOM が混じると列名一致が壊れる)', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('日付,金額')]);
    const result = decodeCsv(withBom);
    expect(result.hadBom).toBe(true);
    expect(result.text).toBe('日付,金額');
  });

  it('明示指定があれば判定せずその文字コードで読む', () => {
    expect(decodeCsv(sjisKonbini, 'shift_jis').text).toBe('ローソン');
  });

  it('ASCII のみなら UTF-8 とみなす', () => {
    expect(decodeCsv(new TextEncoder().encode('date,amount')).encoding).toBe('utf-8');
  });
});

describe('parseDateOnly', () => {
  it.each([
    ['2026/09/08', '2026-09-08'],
    ['2026-09-08', '2026-09-08'],
    ['2026.09.08', '2026-09-08'],
    ['2026/9/8', '2026-09-08'],
    ['20260908', '2026-09-08'],
    ['26/09/08', '2026-09-08'],
    ['2026年9月8日', '2026-09-08'],
    ['令和8年9月8日', '2026-09-08'],
    ['R8.9.8', '2026-09-08'],
    ['平成31年4月30日', '2019-04-30'],
    ['令和元年5月1日', '2019-05-01'],
  ])('%s → %s', (input, expected) => {
    expect(parseDateOnly(input)).toBe(expected);
  });

  it('全角数字と空白を吸収する', () => {
    expect(parseDateOnly('２０２６／０９／０８')).toBe('2026-09-08');
    expect(parseDateOnly(' 2026 / 09 / 08 ')).toBe('2026-09-08');
  });

  it('形式を絞ると、その形式でしか読まない', () => {
    expect(parseDateOnly('20260908', ['YYYYMMDD'])).toBe('2026-09-08');
    expect(() => parseDateOnly('令和8年9月8日', ['YYYY/MM/DD'])).toThrow(DateParseError);
  });

  it('存在しない日付を拒否する', () => {
    expect(() => parseDateOnly('2026/02/30')).toThrow(/解釈できません/);
    expect(() => parseDateOnly('2026/13/01')).toThrow(/解釈できません/);
  });

  it('空文字を拒否する', () => {
    expect(() => parseDateOnly('   ')).toThrow(/空/);
  });

  it('未知の形式名を指定したら、使える形式を挙げてエラーにする', () => {
    expect(() => parseDateOnly('2026/09/08', ['DD-MM-YYYY'])).toThrow(/使えるのは/);
  });

  it('エラーには入力値と試した形式を含める(本人が原因を追えるように)', () => {
    expect(() => parseDateOnly('9月8日', ['YYYY/MM/DD'])).toThrow(/"9月8日".*YYYY\/MM\/DD/s);
  });
});
