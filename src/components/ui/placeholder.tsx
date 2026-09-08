/**
 * 未実装画面の置き。どのタスクで埋まるかを画面上に書いておく。
 * ナビゲーションのリンク切れを typedRoutes で検出できる状態を保つためでもある。
 */
export function Placeholder({
  title,
  taskId,
  description,
}: {
  title: string;
  taskId: string;
  description: string;
}) {
  return (
    <div className="rise space-y-4">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        {title}
      </h1>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {description}
      </p>
      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="size-1.5 rounded-full"
            style={{ background: 'var(--ink-muted)' }}
            aria-hidden
          />
          <span
            className="text-[11px] font-medium tracking-[0.08em] uppercase"
            style={{ color: 'var(--ink-muted)' }}
          >
            未実装
          </span>
        </div>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          <span className="font-mono font-medium">{taskId}</span> で実装します(TASKS.md 参照)。
        </p>
      </div>
    </div>
  );
}
