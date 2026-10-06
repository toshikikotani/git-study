import type { Verification } from '@/features/forecast/calibration';
import type { DateOnly } from '@/lib/date';

/** この予測が過去の月でどれだけ当たったか(自分の記録での検証)。 */
export function VerificationCard({
  verification,
  monthStart,
}: {
  verification: Verification | null;
  /** 今の月の初日。検証が無いとき「○月が終わると」に使う。 */
  monthStart?: DateOnly;
}) {
  return (
    <section
      aria-label="予測の検証"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        予測の当たり具合
      </p>
      {verification === null ? (
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {monthStart
            ? `${Number(monthStart.slice(5, 7))}月が終わると、予測が当たったかを出せます。`
            : '月が1つ終わると、予測が当たったかを出せます。'}
        </p>
      ) : (
        <>
          <p
            className="tabular mt-2 text-4xl leading-none font-semibold tracking-[-0.045em]"
            style={{ color: 'var(--ink)' }}
          >
            {Math.round(verification.summary.calibratedHitRate80 * 100)}%
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            過去{verification.summary.months}か月・{verification.summary.pointCount}
            回の予測(2日おき)を、補正したうえで実際と比べたとき、着地が「10回中8回の幅」に入った割合
            (目安は80%)。補正の前は{Math.round(verification.summary.hitRate80 * 100)}
            %、中央値のずれは平均 {Math.round(verification.summary.medianAbsErrorRatio * 100)}%。
            {verification.summary.months < 3 ? ' 確かめられた月がまだ少ないので、目安。' : ''}
          </p>
        </>
      )}
    </section>
  );
}
