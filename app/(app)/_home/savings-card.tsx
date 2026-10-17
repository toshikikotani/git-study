import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate, formatSignedEstimate } from '@/domain/forecast/format';

export type SavingsCardProps = {
  /** 「10月31日まで」 */
  untilLabel: string;
  /** 月末に残る見込み(収入 − 支出の中央)。収入が無ければ null。 */
  balance: { p50: number; incomeYen: number } | null;
  /** 毎月の貯金目標(設定、AIの窓口と同じ値)。0 なら決めていない。 */
  monthlyTargetYen: number;
  /** 今月これまでの収入 − 支出。読めなければ null。 */
  nowYen: number | null;
};

/** 万の単位を省いた「27.5万」(収入 − 支出の式の中で使う)。 */
function man(yen: number): string {
  return formatEstimate(yen, { approx: false }).replace('円', '');
}

/**
 * 貯金(デザイン v3-1、ADR-108):毎月の貯金目標と、いま・月末の見込み。
 * 貯金目標は設定の1か所(AIの窓口も同じ値)で持つ。画面は「目標はまだありません」、AIは「目標10万円」と
 * 食い違っていた(本人の指摘)。押すと貯金の画面(目標を決める・直す)へ。
 */
export function SavingsCard({ untilLabel, balance, monthlyTargetYen, nowYen }: SavingsCardProps) {
  const hasTarget = monthlyTargetYen > 0;
  const projected = balance?.p50 ?? null;
  const ratio =
    hasTarget && projected !== null ? Math.min(1, Math.max(0, projected / monthlyTargetYen)) : 0;
  const shortYen = hasTarget && projected !== null ? monthlyTargetYen - projected : null;
  return (
    <section aria-labelledby="home-savings" className="flex flex-col gap-2">
      <h2
        id="home-savings"
        className="px-1 pt-3 text-[22px] font-bold"
        style={{ color: 'var(--ink)' }}
      >
        貯金
      </h2>
      <Link
        href="/savings"
        className="flex flex-col rounded-[22px] px-5 pt-5 pb-2"
        style={{ background: 'var(--surface)', color: 'var(--ink)' }}
      >
        {hasTarget ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
                貯金目標 · 毎月
              </span>
              <span className="tabular text-[17px] font-bold">
                {formatEstimate(monthlyTargetYen, { approx: false })}
              </span>
            </div>
            <span
              aria-hidden
              className="relative mt-3 block h-2 overflow-hidden rounded-full"
              style={{ background: 'var(--track)' }}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${ratio * 100}%`, background: 'var(--income)' }}
              />
            </span>
          </>
        ) : (
          <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            {untilLabel}
          </span>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <span className="flex flex-col">
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              いま
            </span>
            <span className="tabular text-[20px] font-bold">
              {nowYen === null ? '—' : formatSignedEstimate(nowYen)}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              月末の見込み
            </span>
            <span
              className="tabular text-[20px] font-bold"
              style={{
                color:
                  projected === null
                    ? 'var(--ink)'
                    : projected >= 0
                      ? 'var(--income)'
                      : 'var(--state-caution)',
              }}
            >
              {projected === null ? '—' : formatSignedEstimate(projected)}
            </span>
          </span>
        </div>
        <span
          className="tabular mt-2 text-[13px] leading-normal"
          style={{ color: 'var(--ink-muted)' }}
        >
          {balance
            ? `収入 ${man(balance.incomeYen)} − 支出 ${man(balance.incomeYen - balance.p50)}。`
            : '収入を記録すると、月末の見込みを出せます。'}
          {shortYen !== null
            ? shortYen > 0
              ? `目標まであと${formatEstimate(shortYen)}。`
              : '目標に届く見込みです。'
            : ''}
        </span>
        <div className="mt-3 h-px" style={{ background: 'var(--hairline)' }} />
        <span
          className="flex min-h-12 items-center justify-between text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          {hasTarget ? '貯金を見る' : '毎月の貯金目標を決める'}
          <ChevronRightIcon />
        </span>
      </Link>
    </section>
  );
}
