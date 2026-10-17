'use client';

/** 期間も目標全体の下書き。「今期の目標」の保存で配分と一緒に確定する。 */
export function PlanPeriodForm({
  periodStart,
  periodEnd,
  onChange,
}: {
  periodStart: string;
  periodEnd: string;
  onChange: (period: { start: string; end: string }) => void;
}) {
  const field = 'min-h-11 rounded-lg px-3 text-base';
  const fieldStyle = { background: 'var(--plane)', color: 'var(--ink)' };
  return (
    <div className="space-y-3">
      <label className="flex min-h-11 items-center justify-between gap-3 text-base">
        <span style={{ color: 'var(--ink)' }}>はじまり</span>
        <input
          type="date"
          value={periodStart}
          onChange={(e) => onChange({ start: e.target.value, end: periodEnd })}
          className={field}
          style={fieldStyle}
        />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-base">
        <span style={{ color: 'var(--ink)' }}>おわり</span>
        <input
          type="date"
          value={periodEnd}
          onChange={(e) => onChange({ start: periodStart, end: e.target.value })}
          className={field}
          style={fieldStyle}
        />
      </label>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        期間・総額・配分は、編集画面上部の「保存」でまとめて保存します。
      </p>
    </div>
  );
}
