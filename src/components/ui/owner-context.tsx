'use client';

import { createContext, useContext } from 'react';

const Ctx = createContext(false);

/** いま見ているユーザーがオーナーか(連携系の入り口を、オーナー以外には出さないため)。 */
export function OwnerProvider({
  isOwner,
  children,
}: {
  isOwner: boolean;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={isOwner}>{children}</Ctx.Provider>;
}

export function useIsOwner(): boolean {
  return useContext(Ctx);
}
