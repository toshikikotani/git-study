import type { Verification } from '@/features/forecast/calibration';

/** この予測が過去の月でどれだけ当たったか(自分の記録での検証)。 */
export function VerificationCard({ verification }: { verification: Verification | null }) {
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
          過去の月で試すには、記録がまだ足りない。1か月以上たまると、予測が当たったかを出す。
        </p>
      ) : (
        <>
          <p
            className="tabular mt-2 text-4xl leading-none font-semibold tracking-[-0.045em]"
            style={{ color: 'var(--ink)' }}
          >
            {Math.round(verification.summary.hitRate80 * 100)}%
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            過去{verification.summary.pointCount}回の予測のうち、実際の着地が「10回中8回の幅」に
            入った割合(目安は80%)。中央値のずれは平均{' '}
            {Math.round(verification.summary.medianAbsErrorRatio * 100)}%。
            {verification.calibration.widthFactor !== 1
              ? ` 幅は${verification.calibration.widthFactor.toFixed(2)}倍に補正している。`
              : ''}
          </p>
        </>
      )}
    </section>
  );
}
