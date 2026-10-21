/**
 * いちばん外側(ADR-132)。ログインしていれば「今日」などのタブと「記録する」、していなければログインだけ。
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { SessionProvider, useSessionState } from '~/lib/session';

export default function RootLayout() {
  const { session, ready } = useSessionState();
  // 端末に残したログインを読むまでは何も出さない(ログイン画面が一瞬出ないように)。
  if (!ready) return null;
  return (
    <SessionProvider value={session}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={session !== null}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="record" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={session === null}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </SessionProvider>
  );
}
