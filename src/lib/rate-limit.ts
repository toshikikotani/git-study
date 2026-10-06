/**
 * 固定の窓のレート制限(メモリ上)。サーバーレスでは、インスタンスごとに別々に数える
 * 「できる範囲の歯止め」で、確実な防御ではない(確実にするには CAPTCHA や共有ストアが要る)。
 */
export function createRateLimiter(options: { max: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    /** 通してよければ true(数に入れる)。多すぎれば false。 */
    take(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      // 溜まりすぎないよう、古いキーを掃除する。
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.every((x) => t - x >= options.windowMs)) hits.delete(k);
      }
      return true;
    },
  };
}
