/** ログインの状態(端末に残したログインを読み、変わったら知らせる)。 */
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';

import { clearCache } from './cache';
import { supabase } from './supabase';

const SessionContext = createContext<Session | null>(null);

export function useSessionState(): { session: Session | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') clearCache();
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, ready };
}

export const SessionProvider = SessionContext.Provider;

export function useSession(): Session | null {
  return useContext(SessionContext);
}
