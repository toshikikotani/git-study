import Link from 'next/link';

import { Card } from '@/components/ui/card';

/** オーナーだけの連携の設定画面を、ほかのユーザーに見せるときの案内。 */
export function OwnerOnlyNotice({ title }: { title: string }) {
  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          {title}
        </h1>
        <Link
          href="/"
          className="min-h-11 inline-flex items-center text-xs"
          style={{ color: 'var(--ink-muted)' }}
        >
          戻る
        </Link>
      </header>
      <Card>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          この連携は、アプリの管理者(オーナー)のアカウントだけで使えます。あなたのアカウントでは、
          レシートの撮影や手入力で家計簿をつけられます。
        </p>
      </Card>
    </div>
  );
}
