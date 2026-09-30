/**
 * 大きな id の一覧を、URL の長さの上限に収まる大きさに分けて問い合わせる。
 * PostgREST への `in (...)` は GET の URL に入るため、数百件を超えると失敗する。
 * 結果は入力の順(チャンクの順)のまま返す。
 */
export const ID_QUERY_CHUNK = 50;

export async function mapChunks<T, R>(
  items: readonly T[],
  fn: (chunk: T[]) => PromiseLike<R>,
  size = ID_QUERY_CHUNK,
  concurrency = 6,
): Promise<R[]> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  const out: R[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= chunks.length) return;
      out[i] = await fn(chunks[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return out;
}
