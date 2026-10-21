/** ログイン(メールアドレスとパスワード。Web 版と同じアカウント、ADR-132)。 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '~/components/ui';
import { missingEnv } from '~/lib/env';
import { supabase } from '~/lib/supabase';
import { radius, type, usePalette } from '~/lib/theme';

export default function Login() {
  const c = usePalette();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = missingEnv();

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) setError('メールアドレスまたはパスワードが違います。');
  };

  const field = [styles.input, { backgroundColor: c.surface, color: c.ink }];
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.plane }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <Text style={[styles.title, { color: c.ink }]}>ログイン</Text>
        <Text style={[styles.note, { color: c.inkMuted }]}>
          Web 版と同じメールアドレスとパスワードで入れます。
        </Text>
        {missing.length > 0 ? (
          <Text style={[styles.note, { color: c.over }]}>
            設定が足りません:{missing.join('・')}
          </Text>
        ) : null}
        <View style={styles.fieldBox}>
          <Text style={[styles.label, { color: c.inkSecondary }]}>メールアドレス</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            placeholder="you@example.com"
            placeholderTextColor={c.inkMuted}
            style={field}
          />
        </View>
        <View style={styles.fieldBox}>
          <Text style={[styles.label, { color: c.inkSecondary }]}>パスワード</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={() => void submit()}
            style={field}
          />
        </View>
        {error ? <Text style={[styles.note, { color: c.over }]}>{error}</Text> : null}
        <PrimaryButton
          label={busy ? 'ログインしています…' : 'ログイン'}
          busy={busy}
          disabled={email.trim() === '' || password === '' || missing.length > 0}
          onPress={() => void submit()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 24, gap: 12 },
  title: { fontSize: type.large, fontWeight: '700' },
  note: { fontSize: type.footnote, lineHeight: 18 },
  fieldBox: { gap: 4 },
  label: { fontSize: type.footnote, fontWeight: '600', paddingHorizontal: 4 },
  input: { minHeight: 48, borderRadius: radius.row, paddingHorizontal: 16, fontSize: type.body },
});
