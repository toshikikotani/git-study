import { BackHeader } from '@/components/ui/back-header';

import { ThemePicker } from './theme-picker';

export const dynamic = 'force-dynamic';

export default function ThemeSettingsPage() {
  return (
    <div className="rise hm-page space-y-4">
      <BackHeader
        back={{ href: '/settings', label: '設定' }}
        title="色"
        sub="20の配色から選ぶか、自由に混ぜられる。収入の緑・超過の赤・注意の黄は意味の色なのでそのまま。"
      />
      <ThemePicker />
    </div>
  );
}
