/**
 * AIが「この画面で見てみて」と出せる行き先(show_screen、ADR-103)。会話で答えられないこと・画面のほうが
 * 分かりやすいことは、ここにある画面へのボタンを出す。ここに無い場所へは出さない(行き先をモデルに作らせない)。
 * DBにもネットワークにも触れない(画面とサーバーの両方から使う)。
 */

export const ASSISTANT_SCREENS = {
  today: { href: '/', label: '今日' },
  spending: { href: '/spending', label: '明細' },
  analysis: { href: '/reports', label: '分析 › 目標' },
  month_review: { href: '/reports/month', label: '分析 › 月のふりかえり' },
  frequency: { href: '/reports/frequency', label: '回数と1回の金額' },
  monthly_table: { href: '/reports/monthly', label: '月ごとの表' },
  more_reports: { href: '/reports/more', label: 'そのほかの分析' },
  ai_reports: { href: '/reports/ai', label: 'AIのレポート' },
  goal_edit: { href: '/plan/edit', label: '今期の目標' },
  categories: { href: '/settings/categories', label: 'カテゴリの設定' },
  accounts: { href: '/accounts', label: '口座' },
  receipts: { href: '/transactions/receipt', label: '読み取ったレシート' },
  import_csv: { href: '/transactions/import', label: 'CSVを取り込む' },
  paste_mail: { href: '/transactions/paste', label: 'メールを貼り付ける' },
  duplicates: { href: '/transactions/duplicates', label: '重複の確認' },
  reconcile: { href: '/transactions/reconcile', label: '請求突合' },
  payday: { href: '/payday', label: '給料日' },
  savings: { href: '/savings', label: '貯金' },
  investments: { href: '/investments', label: '投資' },
  side_hustle: { href: '/side-hustle', label: '副業' },
  job_change: { href: '/job-change', label: '転職準備' },
  notifications: { href: '/notifications', label: 'お知らせ' },
  upcoming: { href: '/upcoming', label: 'これからの支払い' },
  theme: { href: '/settings/theme', label: '色のテーマ' },
  ai_settings: { href: '/settings/ai', label: 'AIの設定' },
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
