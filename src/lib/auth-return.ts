/** ログイン後に戻ってよいアプリの画面。API やログイン自身には戻さない。 */
const APP_ROOTS = new Set([
  'accounts',
  'advisor',
  'assistant',
  'briefs',
  'camera',
  'investments',
  'job-change',
  'notifications',
  'payday',
  'plan',
  'reports',
  'savings',
  'settings',
  'side-hustle',
  'spending',
  'transactions',
  'upcoming',
  'welcome',
]);

/**
 * 外部 URL・ログインループ・API への遷移を避け、戻り先を同じアプリの画面に限る。
 * query は残すので、以前の `/spending?capture=1` の入口もログインをまたげる。
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u0020\u007f]/.test(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(value)
  ) {
    return '/';
  }

  try {
    const url = new URL(value, 'https://auth-return.invalid');
    const pathname = decodeURIComponent(url.pathname);
    // 区切りの多重解釈を避ける。query 内の URL エンコードはそのまま残せる。
    if (pathname.includes('%') || /[\\\u0000-\u0020\u007f]/.test(pathname)) return '/';
    if (/%(?:2f|5c)/i.test(url.pathname)) return '/';
    const root = pathname.split('/')[1];
    if (pathname !== '/' && (!root || !APP_ROOTS.has(root))) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
