/**
 * 楽観的更新の実行。画面を先に書き換え(apply)、保存を待つ。保存に失敗したら元へ戻し(rollback)、
 * 理由を返す。成功なら保存の結果をそのまま返す。
 */
export async function optimistic<T extends { error: string | null }>(steps: {
  apply: () => void;
  rollback: () => void;
  request: () => Promise<T>;
}): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  steps.apply();
  try {
    const result = await steps.request();
    if (result.error !== null) {
      steps.rollback();
      return { ok: false, error: result.error };
    }
    return { ok: true, result };
  } catch {
    steps.rollback();
    return {
      ok: false,
      error: '保存できませんでした。通信状況を確かめて、もう一度お試しください。',
    };
  }
}
