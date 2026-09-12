/**
 * カード利用金額のお知らせ(締め日単位の合計金額)メールの解析(FR-18, M6-4)。
 *
 * `email.ts` が扱う「1件ごとの利用通知」とは別物。こちらは「今回のご請求
 * 金額は◯◯円です」のように、締め期間全体の合計だけを伝えるメールを想定する。
 * ラベル + 区切り + 値という共通の形は email.ts と同じ考え方(発行元ごとの
 * テンプレートではなく語彙だけを持つ)。
 *
 * ── 期間の扱いについて ──────────────────────────────────────
 * 「ご利用期間:2026年8月11日〜2026年9月10日」のように年月日が揃っている
 * 記載だけを対象にする(「9月10日締め」のような年省略の書式は対象外)。
 * 期間が読み取れなくても、口座の締め日(accounts.closing_day)から
 * 呼び出し側(domain/statement-reconciliation.ts)が補える。
 */

import { parseYen } from '@/domain/money';
import type { DateOnly } from '@/lib/date';
import { parseDateOnly } from './date-parse';

export type ParsedStatement = {
  /** 使用金額(円、正の数)。 */
  totalYen: number;
  /** 読み取れなければ null。 */
  periodStartOn: DateOnly | null;
  periodEndOn: DateOnly | null;
};

export type StatementParseResult = {
  statement: ParsedStatement | null;
  warnings: string[];
};

const TOTAL_LABEL =
  /(?:ご請求(?:予定)?金額|お支払(?:い)?金額|ご利用(?:金額)?合計|合計ご利用金額|今回の?ご利用金額(?:合計)?)/;
const PERIOD_LABEL = /(?:ご利用期間|対象期間|利用期間)/;
const SEPARATOR = /[\s]*[:：]?[\s]*/;
const DATE_TOKEN = /\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?/;
const PERIOD_RANGE = new RegExp(`(${DATE_TOKEN.source})\\s*[〜~\\-ー]\\s*(${DATE_TOKEN.source})`);
const DATE_FORMATS = ['YYYY年M月D日', 'YYYY/MM/DD'] as const;

function stripBrackets(line: string): string {
  return line.replace(/[【】[\]（）()]/g, ' ');
}

/**
 * 統合請求のお知らせメールから、使用金額合計と対象期間を取り出す。
 * 金額を読み取れなければ statement は null(このメールでは突き合わせできない)。
 */
export function parseStatementEmail(body: string): StatementParseResult {
  const lines = body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => stripBrackets(l).trim())
    .filter((l) => l !== '');

  let totalYen: number | null = null;
  let periodStartOn: DateOnly | null = null;
  let periodEndOn: DateOnly | null = null;
  const warnings: string[] = [];

  for (const line of lines) {
    if (totalYen === null) {
      const matcher = new RegExp(`${TOTAL_LABEL.source}${SEPARATOR.source}([\\d,，]+)\\s*円`);
      const matched = matcher.exec(line);
      if (matched?.[1] !== undefined) {
        try {
          totalYen = Math.abs(parseYen(matched[1]));
        } catch {
          warnings.push(`金額として解釈できませんでした: ${matched[1]}`);
        }
      }
    }

    if (periodStartOn === null || periodEndOn === null) {
      if (PERIOD_LABEL.test(line)) {
        const matched = PERIOD_RANGE.exec(line);
        if (matched?.[1] !== undefined && matched[2] !== undefined) {
          try {
            periodStartOn = parseDateOnly(matched[1], DATE_FORMATS);
            periodEndOn = parseDateOnly(matched[2], DATE_FORMATS);
          } catch {
            warnings.push(`期間として解釈できませんでした: ${matched[0]}`);
          }
        }
      }
    }
  }

  if (totalYen === null) {
    warnings.push(
      'このメールから金額を読み取れませんでした。「ご請求金額」「お支払金額」等の記載があるか確認してください。',
    );
    return { statement: null, warnings };
  }

  return { statement: { totalYen, periodStartOn, periodEndOn }, warnings };
}
