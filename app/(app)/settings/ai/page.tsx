import { ScreenFrame } from '../../screen-frame';
import { Suspense } from 'react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { getAppSettings } from '@/features/settings/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { AiSettingsForm } from './ai-settings-form';

/**
 * AI機能の一括オン/オフ(N1本人要件)。
 *
 * オフにすると、レポート・家計アシスタント・自然文入力などAIを呼ぶ画面は
 * すべて「AIを使わない代替表示」に切り替わる(各機能がここを毎回確認する、
 * src/lib/ai-gateway/settings.ts の isAiEnabled())。記録・集計・予算といった
 * アプリの基本機能はAIに依存していないため、オフでも変わらず使える。
 */
export default function AiSettingsPage() {
  return (
    <Suspense fallback={<ScreenFrame title="AI設定" />}>
      <AiSettingsPageBody />
    </Suspense>
  );
}

async function AiSettingsPageBody() {
  const settings = await withMinDuration(getAppSettings());

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          AI機能
        </h1>
        <Link href="/spending" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          戻る
        </Link>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        レシートの読み取り・分類、AIレポート、家計アシスタントなど、AIを使う機能を
        まとめてオン/オフできます。オフにしても、記録・集計・予算などアプリの
        基本機能はすべて変わらず使えます。
      </p>

      <Card>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          設定
        </h2>
        <div className="mt-3">
          <AiSettingsForm aiEnabled={settings.aiEnabled} />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          AIについて
        </h2>
        <ul className="mt-3 space-y-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          <li>・AIの計算はすべて台帳の集計関数の結果に基づき、AIが数字を作ることはありません</li>
          <li>・AIが書いた文章には小さな「AI」ラベルと、根拠データへのリンクが付きます</li>
          <li>・AIへ送るのは店名・品目名・金額・日付など必要最小限のデータだけです</li>
          <li>・端末内で完結できる処理(音声のテキスト化等)は端末内で行います</li>
        </ul>
      </Card>
    </div>
  );
}
