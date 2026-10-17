/** Small hook host for client behavior tests without a browser dependency. */
export function createHookState() {
  let slots: unknown[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [
        slots[index] as T,
        (next) => {
          slots[index] =
            typeof next === 'function' ? (next as (previous: T) => T)(slots[index] as T) : next;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useMemo<T>(compute: () => T, deps: readonly unknown[]): T {
      const index = cursor++;
      const previous = slots[index] as { deps: readonly unknown[]; value: T } | undefined;
      if (!previous || !same(previous.deps, deps)) slots[index] = { deps, value: compute() };
      return (slots[index] as { value: T }).value;
    },
    useCallback<T>(callback: T, deps: readonly unknown[]): T {
      return hooks.useMemo(() => callback, deps);
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as
        { deps?: readonly unknown[]; cleanup?: () => void } | undefined;
      if (previous && same(previous.deps, deps)) return;
      const next = { deps, cleanup: undefined as (() => void) | undefined };
      slots[index] = next;
      effects.push(() => {
        previous?.cleanup?.();
        next.cleanup = effect() || undefined;
      });
    },
  };
  return {
    hooks,
    begin: () => {
      cursor = 0;
    },
    flush: () => {
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
    },
    reset: () => {
      slots = [];
      cursor = 0;
      effects = [];
    },
  };
}
