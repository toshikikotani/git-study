/** 家計簿の枠。数字が届く前に、同じ並びを先に出す。 */
export function SpendingFrame() {
  return (
    <div role="status" aria-label="家計簿を読み込み中" className="space-y-3">
      <div
        className="flex items-center justify-between rounded-full px-4 py-3"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          ‹
        </span>
        <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          今月
        </span>
        <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          ›
        </span>
      </div>
      <div
        className="grid grid-cols-3 rounded-full p-1 text-center text-xs"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <span className="rounded-full py-2 font-semibold" style={{ color: 'var(--ink)' }}>
          概要
        </span>
        <span className="py-2" style={{ color: 'var(--ink-muted)' }}>
          明細
        </span>
        <span className="py-2" style={{ color: 'var(--ink-muted)' }}>
          レポート
        </span>
      </div>
      <FrameCard className="h-36" />
      <FrameCard className="h-52" />
      <FrameCard className="h-40" />
      <FrameCard className="h-16" />
      <FrameCard className="h-16" />
    </div>
  );
}

function FrameCard({ className }: { className: string }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    />
  );
}
