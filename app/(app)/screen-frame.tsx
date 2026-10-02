/** どの画面でも、数字の前に出す枠。 */
export function ScreenFrame({ title }: { title: string }) {
  return (
    <div role="status" aria-label={`${title}を読み込み中`} className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        {title}
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
        className="h-40 rounded-2xl"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      />
    </div>
  );
}
