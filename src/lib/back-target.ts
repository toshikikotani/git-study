/**
 * 下の階層の画面の「‹ 戻り先」(提案書「戻るボタンは ‹ 前の画面の名前 だけ」、ADR-127)。開いた画面を
 * `?from=` で受け取り、その画面の名前を出す。知らない行き先・外へのリンクは使わず、決まった戻り先にする。
 * DBにもネットワークにも触れない。
 */

export type BackTarget = { href: string; label: string };

/** 戻れる画面と、その名前(長い順に見る)。 */
const KNOWN: readonly (readonly [prefix: string, label: string])[] = [
  ['/reports/month', '月のふりかえり'],
  ['/spending/review', '確認が必要'],
  ['/settings', '設定'],
  ['/spending', '明細'],
  ['/reports', '分析'],
  ['/assistant', 'AI'],
  ['/savings', '貯金'],
  ['/upcoming', '予定と固定費'],
  ['/accounts', '口座'],
  ['/plan/edit', '今期の目標'],
];

export const TODAY_BACK: BackTarget = { href: '/', label: '今日' };
export const SETTINGS_BACK: BackTarget = { href: '/settings', label: '設定' };

/** `from` が知っている画面なら、その戻り先。知らなければ null。 */
export function knownBackTarget(from: unknown): BackTarget | null {
  const value = Array.isArray(from) ? from[0] : from;
  if (typeof value !== 'string' || !value.startsWith('/') || /^\/[/\\]/.test(value)) return null;
  if (value === '/') return TODAY_BACK;
  const path = value.split(/[?#]/)[0] ?? '';
  for (const [prefix, label] of KNOWN) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return { href: value, label };
  }
  return null;
}

export function backTargetOf(from: unknown, fallback: BackTarget = TODAY_BACK): BackTarget {
  return knownBackTarget(from) ?? fallback;
}
