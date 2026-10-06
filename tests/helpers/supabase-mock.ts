/**
 * Supabase のクエリビルダ(from().select().gte()...)の連なりを受け、最後に
 * 用意した結果を返す簡易モック。テーブルごとに結果を差し替えられる。
 */

export type MockResult = { data: unknown; error: { code?: string; message: string } | null };

export function chain(result: MockResult | (() => MockResult)) {
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) =>
          resolve(typeof result === 'function' ? result() : result);
      }
      return () => proxy;
    },
  });
  return proxy;
}

export function mockClient(tables: Record<string, MockResult | (() => MockResult)>) {
  return {
    from: (table: string) => chain(tables[table] ?? { data: [], error: null }),
  };
}
