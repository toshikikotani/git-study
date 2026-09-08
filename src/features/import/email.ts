/**
 * カード利用通知メールの解析(FR-10, 仕様書 9.2)。
 *
 * ── なぜメールが主経路なのか ────────────────────────────────
 * 設計原則2は「記録の手間を最小化。手入力は例外」。CSV の月次取り込みは
 * 儀式として成立するが、それだけでは月末までリボ利用に気づけない。
 * FR-21 の即時アラートを成り立たせるには、日々届く通知メールを
 * 自動で読む経路が要る(仕様書 9.2 が「リボ/キャッシング検知の主経路」と
 * 位置づけているのはこのため)。
 *
 * ── 解析の方針 ──────────────────────────────────────────────
 * 発行元ごとにテンプレートを書くと、様式変更のたびに壊れる。
 * 国内のカード通知メールは「ラベル + 区切り + 値」という形が共通なので、
 * ラベルの語彙だけを知っていれば足りる。
 *
 *   ご利用日時：2026/09/03 12:34
 *   【ご利用金額】3,500円
 *   ご利用先: ローソン渋谷
 *
 * 1通に複数の明細が並ぶ形式もあるため、同じラベルが再び現れたら
 * そこで1件を確定して次へ進む。
 */

import { parseYen } from '@/domain/money';
import type { DateOnly } from '@/lib/date';
import { parseDateOnly } from './date-parse';
import { readPaymentMethod, type PaymentMethod } from './adapters';

export type ParsedEmailTransaction = {
  occurredOn: DateOnly;
  description: string;
  /** 支出が負(ADR-008)。利用通知は支出として扱う。 */
  amountYen: number;
  paymentMethod: PaymentMethod;
};

export type EmailParseResult = {
  transactions: ParsedEmailTransaction[];
  /** 取りこぼしを黙って捨てないための記録。画面とログに出す。 */
  warnings: string[];
};

type Field = 'date' | 'amount' | 'merchant' | 'method';

/**
 * ラベルの語彙。発行元ごとのテンプレートではなく、この語彙だけを持つ。
 * 新しい発行元で取りこぼしたら、ここに1語足せば済む。
 */
const LABELS: Record<Field, RegExp> = {
  date: /(?:ご?利用日時?|ご?利用年月日|取引日時?|お取引日|決済日|日付)/,
  amount: /(?:ご?利用金額|ご?請求金額|決済金額|お支払金額|金額)/,
  merchant: /(?:ご?利用先|ご?利用店名?|ご?利用場所|加盟店名?|店舗名?|利用加盟店)/,
  method: /(?:お?支払方法|支払区分|ご?利用区分|お支払区分)/,
};

/** ラベルと値のあいだに入りうる区切り。全角コロン・括弧閉じ・タブなど。 */
const SEPARATOR = /[\s]*[:：]?[\s]*/;

/** 【ラベル】値 の形にも対応するため、括弧は事前に落とす。 */
function stripBrackets(line: string): string {
  return line.replace(/[【】\[\]（）()]/g, ' ');
}

/**
 * 通知メールの本文から明細を取り出す。
 *
 * 解析できなかった項目があっても、日付と金額が揃っていれば1件として扱う。
 * 店名が取れないだけで丸ごと捨てるより、摘要を空欄にして本人に見せる方がよい。
 */
export function parseNotificationEmail(body: string): EmailParseResult {
  const lines = body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => stripBrackets(l).trim())
    .filter((l) => l !== '');

  const transactions: ParsedEmailTransaction[] = [];
  const warnings: string[] = [];

  let current: Partial<Record<Field, string>> = {};

  const flush = () => {
    if (current.date === undefined && current.amount === undefined) {
      current = {};
      return;
    }
    const built = build(current, warnings);
    if (built) transactions.push(built);
    current = {};
  };

  for (const line of lines) {
    for (const field of ['date', 'amount', 'merchant', 'method'] as const) {
      const value = extract(line, LABELS[field]);
      if (value === undefined) continue;

      // 同じ項目が再び出てきたら、そこまでで1件が完結したとみなす
      if (current[field] !== undefined) flush();
      current[field] = value;
      break;
    }
  }
  flush();

  if (transactions.length === 0 && warnings.length === 0) {
    warnings.push(
      'このメールから明細を読み取れませんでした。カード会社の利用通知メールを貼り付けてください。',
    );
  }

  return { transactions, warnings };
}

function extract(line: string, label: RegExp): string | undefined {
  // 行頭に固定しない。実際のメールは「カード利用日」「ご利用日時」のように
  // 接頭辞が付く。固定すると発行元ごとに取りこぼす。
  const matcher = new RegExp(`${label.source}${SEPARATOR.source}(.+)$`);
  const matched = matcher.exec(line);
  const value = matched?.[1]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function build(
  fields: Partial<Record<Field, string>>,
  warnings: string[],
): ParsedEmailTransaction | null {
  if (fields.date === undefined) {
    warnings.push(`日付が読み取れない明細を飛ばしました(金額: ${fields.amount ?? '不明'})`);
    return null;
  }
  if (fields.amount === undefined) {
    warnings.push(`金額が読み取れない明細を飛ばしました(日付: ${fields.date})`);
    return null;
  }

  let occurredOn: DateOnly;
  try {
    // 「2026/09/03 12:34」のように時刻が続く形式があるため、日付部分だけを渡す
    occurredOn = parseDateOnly(fields.date.split(/[\s]/)[0] ?? fields.date);
  } catch {
    warnings.push(`日付として解釈できませんでした: ${fields.date}`);
    return null;
  }

  let amount: number;
  try {
    amount = parseYen(fields.amount.replace(/円.*$/, ''));
  } catch {
    warnings.push(`金額として解釈できませんでした: ${fields.amount}`);
    return null;
  }

  return {
    occurredOn,
    // 利用通知は支出。符号は取り込み側で迷わないようここで確定させる(ADR-008)
    amountYen: -Math.abs(amount),
    description: fields.merchant ?? '(店名不明)',
    paymentMethod: readPaymentMethod(fields.method),
  };
}
