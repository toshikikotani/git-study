import Link from 'next/link';

import { formatYen } from '@/domain/money';
import { loadAccumulationView, type AccumulationView } from '@/features/accumulation/store';
import { formatDateJa } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';

/**
 * 「ちりつも」(本人発案)。
 *
 * ── なぜ作ったか ────────────────────────────────────────────
 * 既存の家計簿(ホームの「あと◯円使える」・/reports のカテゴリ別推移)は
 * どちらも **引き算** の見せ方で、1回400円のような支出はどこにも現れない。
 * この画面はその逆側——小さな支出を回数と年換算で **掛け算** し、最後に
 * 「完済が何ヶ月延びるか」へ翻訳する。480円が「完済2ヶ月」に見えた瞬間が、
 * ちりつもの実感そのもの(換算は domain/payoff.ts の
 * payoffImpactOfExtraPayment。既存の完済シミュレータを支出側に転用している)。
 *
 * ── 文言の方針(設計原則5:責めない)────────────────────────
 * 「使いすぎ」と判定しない。出すのは事実(回数・合計・このペースが続いた場合)
 * だけにとどめ、警告色のカード(リボ検知のような var(--over-track) の面)は
 * 使わない。棒の色だけは既存の支出表示(P6-2)と同じ var(--over) を踏襲する。
 *
 * ── なぜ /spending/pile なのか(P10-6、本人発案)────────────────
 * 元は /spending 自体がこの画面だったが、「ちりつもだけ表示されてて微妙。
 * 普通の一般的な家計簿を表示し補助でちりつもの項目を作るべき」というフィード
 * バックを受け、/spending は収支サマリー・カテゴリ別内訳・今月の明細・予測を
 * 持つ通常の家計簿画面に作り直した。ちりつもはその「補助」の位置づけとして
 * ここへ移し、/spending からカードでリンクする形にした。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPilePage() {
  const view = await withMinDuration(loadAccumulationView());

  return (
    <div className="rise space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <Link
            href="/spending"
            className="text-[11px] font-medium"
            style={{ color: 'var(--ink-muted)' }}
          >
            ← 家計簿
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            ちりつも
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {formatDateJa(view.period.from)} 〜 {formatDateJa(view.period.to)}
          </p>
        </div>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          明細
        </Link>
      </header>

      <SmallSpendHero view={view} />
      <SmallSpendPile view={view} />
      <NoSpendCard view={view} />
      <PaceCard view={view} />
    </div>
  );
}

/**
 * 今月の小口支出とその年換算(ヒーロー数値)。
 *
 * 年換算は「合計 × 12」ではなく1日あたりに均してから365倍する
 * (月初の数日で大きく過小評価しないため。domain/accumulation.ts 参照)。
 */
function SmallSpendHero({ view }: { view: AccumulationView }) {
  return (
    <div
      className="rounded-3xl p-6"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        今月の小口支出({formatYen(view.thresholdYen, { sign: 'never' })}未満)
      </p>
      <p
        className="mt-1 text-4xl leading-none font-semibold tracking-tight"
        style={{ color: 'var(--ink)' }}
      >
        {formatYen(view.smallSpendTotalYen, { sign: 'never' })}
      </p>

      {view.smallSpendTotalYen > 0 ? (
        <dl className="mt-4 space-y-2 border-t pt-4" style={{ borderColor: 'var(--hairline)' }}>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
              このペースが1年続くと
            </dt>
            <dd className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {formatYen(view.smallSpendAnnualizedYen, { sign: 'never' })}
            </dd>
          </div>

          {/* 完済の短縮は月単位でしか動かないため、小さな額では0ヶ月になる。
              そのとき利息だけが動く(それも立派なちりつも)ので、行が単独でも
              意味が通る文言にしておく。 */}
          {view.payoffImpact !== null && view.payoffImpact.savedInterestYen > 0 ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                同じ額を返済に回すと
              </dt>
              <dd
                className="tabular text-right text-sm font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                利息が {formatYen(view.payoffImpact.savedInterestYen, { sign: 'never' })} 減る
                {view.payoffImpact.shortenedMonths > 0 ? (
                  <>
                    <br />
                    完済も {view.payoffImpact.shortenedMonths}ヶ月 早まる
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          今月はまだ小口の支出が記録されていません。
        </p>
      )}
    </div>
  );
}

/**
 * 小口の山(店ごとの合計、多い順)。
 *
 * 金額より回数が効く(「37回」は「18,400円」より刺さる)ため、回数を必ず添える。
 * 色は単一系列の大きさを表すだけなので、支出の役割色 var(--over) 一色
 * (P6-2 と同じ判断。カテゴリ・店に色を割り当てない)。各行が数値を直接
 * 持つため、この一覧がそのまま表(table view)を兼ねる。
 */
function SmallSpendPile({ view }: { view: AccumulationView }) {
  if (view.smallSpends.length === 0) return null;

  const maxYen = Math.max(...view.smallSpends.map((group) => group.totalYen), 1);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        小口の山
      </p>

      <ul className="mt-3 space-y-3">
        {view.smallSpends.map((group) => (
          <li key={group.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
                {group.label}
              </span>
              <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
                {formatYen(group.totalYen, { sign: 'never' })}
              </span>
            </div>

            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--over-track)' }}
              title={`${group.label} ${group.count}回 ${formatYen(group.totalYen, {
                sign: 'never',
              })}`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round((group.totalYen / maxYen) * 100)}%`,
                  background: 'var(--over)',
                }}
              />
            </div>

            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {group.count}回 / 1回あたり {formatYen(group.averageYen, { sign: 'never' })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 使わなかった日の積み上げ(FR-62 のストリークと対になる「貯まる側」)。
 * 平均は「支出があった日」だけで割る(domain/accumulation.ts 参照)。
 */
function NoSpendCard({ view }: { view: AccumulationView }) {
  const { noSpend } = view;
  if (noSpend.elapsedDays === 0) return null;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          使わなかった日
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {noSpend.noSpendDays} / {noSpend.elapsedDays}日
        </p>
      </div>

      {noSpend.noSpendDays > 0 && noSpend.averageSpendPerSpentDayYen > 0 ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          使った日の平均は {formatYen(noSpend.averageSpendPerSpentDayYen, { sign: 'never' })}。
          使わなかった日の分で{' '}
          <span
            className="tabular font-semibold whitespace-nowrap"
            style={{ color: 'var(--income)' }}
          >
            {formatYen(noSpend.preservedYen, { sign: 'never' })}
          </span>{' '}
          が手元に残っています。
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          今月はまだ集計できる日がありません。
        </p>
      )}
    </div>
  );
}

/**
 * 前月同日比。月末を待たずに差が見えるようにする。
 *
 * globals.css の通り緑×赤は通常視の識別が境界帯のため、色だけに意味を
 * 持たせず「少ない/多い」の語を必ず併記する。
 */
function PaceCard({ view }: { view: AccumulationView }) {
  const { pace } = view;
  const isLess = pace.differenceYen < 0;
  const hasDifference = pace.differenceYen !== 0;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          先月の同じ日まで との比較
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {formatYen(pace.thisMonthToDateYen, { sign: 'never' })}
        </p>
      </div>

      <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        先月の{pace.dayOfMonth}日時点は {formatYen(pace.lastMonthSameDayYen, { sign: 'never' })}。
        {hasDifference ? (
          <>
            {' '}
            今月は{' '}
            <span
              className="tabular font-semibold whitespace-nowrap"
              style={{ color: isLess ? 'var(--income)' : 'var(--over)' }}
            >
              {formatYen(pace.differenceYen, { sign: 'never' })} {isLess ? '少ない' : '多い'}
            </span>
            。
          </>
        ) : (
          ' 今月はちょうど同じです。'
        )}
      </p>
    </div>
  );
}
