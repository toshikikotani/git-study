export default function PlanLoading() {
  return (
    <div role="status" aria-label="目標を読み込み中" className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        目標
      </h1>
      <div
        className="h-36 rounded-3xl"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      />
      <div
        className="h-24 rounded-2xl"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      />
      <div
        className="h-64 rounded-2xl"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      />
    </div>
  );
}
