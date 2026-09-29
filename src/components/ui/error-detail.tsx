/**
 * エラー画面の小さな「詳しい内容」。原因を切り分けるため、メッセージと digest(サーバー側の
 * ログと突き合わせる番号)を、タップで開ける形で出す。家計簿の記録には影響しない。
 */
export function ErrorDetail({ error }: { error: Error & { digest?: string } }) {
  return (
    <details className="w-full max-w-sm text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
      <summary className="min-h-11 cursor-pointer py-3">詳しい内容</summary>
      <p className="break-words">{error.message || '(メッセージなし)'}</p>
      {error.digest ? <p className="mt-1 break-all">digest: {error.digest}</p> : null}
    </details>
  );
}
