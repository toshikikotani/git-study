/**
 * サーバーのデータを読む。まず端末に残した前回の値を出し(開いた瞬間に出る)、画面を開くたび・引っぱった
 * ときに読み直す(ADR-132)。
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { api, ApiError } from './api';
import { readCache, writeCache } from './cache';

export function useRemote<T>(path: string): {
  data: T | null;
  error: string | null;
  refreshing: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(() => readCache<T>(path));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);

  const reload = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setRefreshing(true);
    try {
      const next = await api<T>(path);
      setData(next);
      setError(null);
      writeCache(path, next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '読み込めませんでした。');
    } finally {
      running.current = false;
      setRefreshing(false);
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, error, refreshing, reload };
}
