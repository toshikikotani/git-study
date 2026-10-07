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
          20の配色から選ぶか、自由に混ぜられる。収入の緑・超過の赤・注意の黄は意味の色なのでそのまま。
        </p>
      </header>
      <ThemePicker />
    </div>
  );
}
