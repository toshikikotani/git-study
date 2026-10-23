import type { Route } from 'next';
import Link from 'next/link';

import { DetailSheet } from '@/components/ui/detail-sheet';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { countReadyCaptures, needsInputSummary } from '@/features/home/pending';
import { loadPaydayState, PaydayPanel } from '../payday/payday-panel';
import { TodayCheckLauncher } from '../spending/today-check-launcher';
import { countTodayCheck } from './today-check-card';

/**
 * 今日やること(デザインの課題 #1、ADR-131)。今日の目安の下に1枚だけ出す:保存前のレシート(ADR-133)・
 * 今日の答え合わせ(カテゴリの確認待ちもここに含める)・入力待ちのレシート・給料日の振り分け。もとは目安の上に「確認待ち」「給料日」
 * 「答え合わせ」の3枚が積まれ、確認待ちと答え合わせが同じ記録を別の数で数えていた。
 * どれも無ければ出さない。LINE の「1件ずつ見る」(`?check=today`)から来たら、答え合わせのシートを開く。
 */
export async function TodayTodo({ autoOpen = false }: { autoOpen?: boolean }) {
  const [checkCount, captures, payday, unsaved] = await Promise.all([
    countTodayCheck().catch(() => 0),
    needsInputSummary(),
    loadPaydayState().catch(() => null),
    countReadyCaptures(),
  ]);
  const paydayDue =
    payday !== null && (payday.kind === 'needs_amount' || payday.kind === 'checklist');
  if (checkCount === 0 && captures.count === 0 && !paydayDue && unsaved === 0) {
    return autoOpen ? <TodayCheckLauncher count={0} variant="row" autoOpen /> : null;
  }

  return (
    <section
      aria-labelledby="today-todo"
      className="flex flex-col overflow-hidden rounded-2xl"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <h2
        id="today-todo"
        className="px-4 pt-3 text-[13px] font-semibold"
        style={{ color: 'var(--ink-muted)' }}
      >
        今日やること
      </h2>
      <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-[var(--hairline)]">
        {unsaved > 0 ? <UnsavedReceiptsRow count={unsaved} /> : null}
        <TodayCheckLauncher count={checkCount} variant="row" autoOpen={autoOpen} />
        {captures.count > 0 ? (
          <Link
            href={
              captures.count === 1 && captures.firstId
                ? (`/transactions/receipt/${captures.firstId}?returnTo=${encodeURIComponent('/spending/review')}` as Route)
                : '/spending/review'
            }
            className="flex min-h-14 items-center gap-3 px-4 py-3"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[15px] font-semibold">
                レシート{captures.count}件が入力待ち
              </span>
              <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                画像を見ながら入力する
              </span>
            </span>
            <span style={{ color: 'var(--ink-muted)' }}>
              <ChevronRightIcon />
            </span>
          </Link>
        ) : null}
        {paydayDue ? (
          <DetailSheet
            row
            label="給料日です"
            sub={
              payday.kind === 'needs_amount' ? '入った額から振り分けを出す' : '振り分けを確かめる'
            }
            title="給料日の振り分け"
          >
            <PaydayPanel state={payday} />
          </DetailSheet>
        ) : null}
      </div>
    </section>
  );
}

/** 保存前のレシート N件(まだ明細に入っていない。今日の画面と明細に出す、ADR-133)。 */
export function UnsavedReceiptsRow({ count }: { count: number }) {
  return (
    <Link href="/spending/review" className="flex min-h-14 items-center gap-3 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[15px] font-semibold">保存前のレシート {count}件</span>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          確かめて保存する(まだ明細に入っていません)
        </span>
      </span>
      <span style={{ color: 'var(--ink-muted)' }}>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
