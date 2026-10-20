/**
 * AIが「この画面で見てみて」と出せる行き先(show_screen、ADR-103)。会話で答えられないこと・画面のほうが
 * 分かりやすいことは、ここにある画面へのボタンを出す。ここに無い場所へは出さない(行き先をモデルに作らせない)。
 * DBにもネットワークにも触れない(画面とサーバーの両方から使う)。
 */

export const ASSISTANT_SCREENS = {
  today: { href: '/', label: '今日' },
  spending: { href: '/spending', label: '明細' },
  review: { href: '/spending/review', label: '確認が必要' },
  analysis: { href: '/reports', label: '分析 › 目標' },
  month_review: { href: '/reports/month', label: '分析 › 月のふりかえり' },
  goal_edit: { href: '/plan/edit', label: '今期の目標' },
  categories: { href: '/settings/categories', label: 'カテゴリの設定' },
  accounts: { href: '/accounts', label: '口座' },
  import_csv: { href: '/transactions/import', label: 'CSVを取り込む' },
  import_mail: { href: '/transactions/email', label: 'メールから取り込む' },
  savings: { href: '/savings', label: '貯金' },
  notifications: { href: '/notifications', label: 'お知らせ' },
  upcoming: { href: '/upcoming', label: '予定と固定費' },
  theme: { href: '/settings/theme', label: '色のテーマ' },
  settings: { href: '/settings', label: '設定' },
} as const;

export type AssistantScreen = keyof typeof ASSISTANT_SCREENS;

/** 画面に出すボタン1つ。 */
export type ScreenLink = { href: string; label: string };

export const ASSISTANT_SCREEN_KEYS = Object.keys(ASSISTANT_SCREENS) as AssistantScreen[];

/** モデルが渡した screen を、決まった行き先のボタンにする。知らない名前は null。 */
export function screenLinkOf(screen: unknown): ScreenLink | null {
  if (typeof screen !== 'string' || !(screen in ASSISTANT_SCREENS)) return null;
  const s = ASSISTANT_SCREENS[screen as AssistantScreen];
  return { href: s.href, label: s.label };
}

/** 1回の返事に出すボタンの上限。 */
export const MAX_SCREEN_LINKS = 3;
