import Link from 'next/link';

import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { DuplicateList } from './duplicate-list';

/**
 * 重複候補の確認(本人発案)。
 *
 * 取り込み経路は CSV・メール通知・レシート撮影の3つあるが、既存の重複排除
 * (transactions.fingerprint)は摘要と口座が一致することを前提にしているため、
 * 同じ買い物でも経路が違えば別物として入る(詳細は domain/duplicate-match.ts)。
 * ここはその取りこぼしを本人の目で確定させるための画面。
 */

// 除外した直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function DuplicatesPage() {
  const candidates = await withMinDuration(listDuplicateCandidates());

  return (
    <div className="rise space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            重複の確認
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            同じ金額・近い日付で、別の経路から入った明細
          </p>
        </div>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          明細
        </Link>
      </header>

      <DuplicateList initial={candidates} />

      <p className="px-1 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        残さなかった方は削除せず、集計の対象から外すだけです(予算・レポート・
        ちりつも・アラートから一斉に消えます)。
      </p>
    </div>
  );
}
