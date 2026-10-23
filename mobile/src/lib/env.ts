/** iPhone 版の設定(.env.example・Expo の Environment variables)。どれも公開してよい値。 */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, ''),
};

/** 設定が足りなければ、その名前(画面に出して、何を入れればよいか分かるようにする)。 */
export function missingEnv(): string[] {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!env.apiBaseUrl) missing.push('EXPO_PUBLIC_API_BASE_URL');
  return missing;
}
