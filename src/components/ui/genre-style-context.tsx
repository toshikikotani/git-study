'use client';

import { createContext, useContext } from 'react';

import type { GenreStyleOverride } from '@/domain/genre-style';

const Ctx = createContext<Readonly<Record<string, GenreStyleOverride>>>({});

/** カテゴリ名 → 利用者が選んだ見た目。 */
export function GenreStyleProvider({
  overrides,
  children,
}: {
  overrides: Readonly<Record<string, GenreStyleOverride>>;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={overrides}>{children}</Ctx.Provider>;
}

export function useGenreOverride(name: string | null): GenreStyleOverride | null {
  const all = useContext(Ctx);
  return name === null ? null : (all[name] ?? null);
}

export function useGenreOverrides(): Readonly<Record<string, GenreStyleOverride>> {
  return useContext(Ctx);
}
