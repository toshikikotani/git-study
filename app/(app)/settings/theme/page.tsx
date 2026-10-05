import { ThemePicker } from './theme-picker';

export const dynamic = 'force-dynamic';

export default function ThemeSettingsPage() {
  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          色
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          背景と文字と強調を変えられる。収入の緑と超過の赤はそのまま。
        </p>
      </header>
      <ThemePicker />
    </div>
  );
}
