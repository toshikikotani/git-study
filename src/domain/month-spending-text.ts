/**
 * 1か月分の支出を、LINE やメモに貼れる文字にする(本人「1ヶ月分の支出を出力する機能欲しい」、ADR-134)。
 *
 * 中身:月の合計と件数 → カテゴリ別の合計 → 1件ずつ(日付・お店・金額・カテゴリ・支払い・メモ)。
 * 数え方は明細の「支出」と同じ(domain/ledger.ts の summarizeLedger):振替・数えない記録・入力待ちは
 * 入れない、今日より先の予定は入れない(合計の下に「このほか予定」と書く)、返金は差し引く。
 * レシートの品目は支払い1行にまとめ、分けたカテゴリはカテゴリ別の合計に入れる。
 * カテゴリ別の合計は画面と同じ値(呼び出し側が明細の内訳を渡す)。DB にも画面にも触れない。
 */

import { isCountable } from './budget';
import { entryStatus } from './ledger';
import type { DateOnly } from '@/lib/date';
import { weekdayOf } from '@/lib/date';

const WEEKDAY = '日月火水木金土';
const yen = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ja-JP')}円`;
/** 2026-10-01 → 10/1(水) */
const dayLabel = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAY[weekdayOf(date)]})`;

export type MonthSpendingRow = {
  occurredOn: DateOnly;
  label: string;
  /** 支出が負、収入・返金が正(ADR-008)。 */
  amountYen: number;
  genreName: string | null;
  accountId: string;
  memo: string | null;
  isTransfer: boolean;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  kind: 'normal' | 'special' | 'refund';
  needsInput: boolean;
  splits: readonly { genreName: string | null }[];
};

/** 明細の「支出」に入る記録か(実績の支出と返金)。 */
export function isMonthSpending(row: MonthSpendingRow, today: DateOnly): boolean {
  if (row.needsInput || !isCountable({ ...row, categoryId: null })) return false;
  if (entryStatus(row.occurredOn, today) === 'scheduled') return false;
  return row.amountYen < 0 || row.kind === 'refund';
}

/** その記録のカテゴリ(分けたものは「食料品・日用品」)。 */
function genreLabel(row: MonthSpendingRow): string {
  if (row.splits.length > 0) {
    const names = [...new Set(row.splits.map((s) => s.genreName ?? '未分類'))];
    return names.join('・');
  }
  return row.genreName ?? '未分類';
}

export function monthSpendingText(input: {
  /** 月の1日('YYYY-MM-01')。 */
  monthStart: DateOnly;
  today: DateOnly;
  rows: readonly MonthSpendingRow[];
  /** 明細の「支出」とカテゴリ別の内訳(画面と同じ値)。 */
  spentYen: number;
  scheduledYen: number;
  genreBreakdown: readonly { genreName: string; spentYen: number }[];
  accountName: (accountId: string) => string | null;
}): string {
  const [y, m] = [Number(input.monthStart.slice(0, 4)), Number(input.monthStart.slice(5, 7))];
  const monthKey = input.monthStart.slice(0, 7);
  const rows = input.rows
    .filter((r) => r.occurredOn.startsWith(monthKey) && isMonthSpending(r, input.today))
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  const sofar = input.today.startsWith(monthKey)
    ? `(${Number(input.today.slice(8, 10))}日まで)`
    : '';

  const lines = [`${y}年${m}月の支出${sofar}`, `合計 ${yen(input.spentYen)} · ${rows.length}件`];
  if (input.scheduledYen > 0) lines.push(`(このほか予定 ${yen(input.scheduledYen)})`);

  const genres = input.genreBreakdown
    .filter((g) => g.spentYen !== 0)
    .sort((a, b) => b.spentYen - a.spentYen);
  if (genres.length > 0) {
    lines.push('', '【カテゴリ別】', ...genres.map((g) => `${g.genreName} ${yen(g.spentYen)}`));
  }

  if (rows.length > 0) {
    lines.push(
      '',
      '【1件ずつ】',
      ...rows.map((r) => {
        const spent = -r.amountYen;
        const account = input.accountName(r.accountId);
        const memo = r.memo?.trim() ? `(${r.memo.trim()})` : '';
        const refund = r.kind === 'refund' ? '返金 ' : '';
        return `${dayLabel(r.occurredOn)} ${refund}${r.label} ${yen(spent)} ${genreLabel(r)}${account ? ` / ${account}` : ''}${memo}`;
      }),
    );
  } else {
    lines.push('', 'この月の支出はまだありません。');
  }
  return lines.join('\n');
}
