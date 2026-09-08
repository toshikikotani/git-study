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
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{description}</p>
      <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        この画面は未実装です。<span className="font-mono">{taskId}</span> で実装します(TASKS.md
        参照)。
      </p>
    </div>
  );
}
