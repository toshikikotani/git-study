/**
 * Supabase のクライアント(ログインだけに使う。データの読み書きはサーバーの /api/mobile/* を通して、
 * Web 版と同じ関数で行う、ADR-132)。ログインは端末に残し(expo-sqlite の localStorage)、開くたびに
 * ログインし直さなくてよい。アプリが前にあるあいだだけ、ログインの更新を回す。
 */
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { env } from './env';

export const supabase = createClient(
  env.supabaseUrl || 'https://not-configured.invalid',
  env.supabaseAnonKey || 'not-configured',
  {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
