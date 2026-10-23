/** 設定(いまはアカウントとログアウト。ほかの設定は Web 版で、ADR-132)。 */
import * as Linking from 'expo-linking';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Row, SectionTitle } from '~/components/ui';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { type, usePalette } from '~/lib/theme';

export default function Settings() {
  const c = usePalette();
  const session = useSession();
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: c.plane }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.title, { color: c.ink }]}>設定</Text>
        <Card>
          <SectionTitle>アカウント</SectionTitle>
          <Row title={session?.user.email ?? ''} sub="でログイン中" />
          <Row divider title="ログアウト" onPress={() => void supabase.auth.signOut()} />
        </Card>
        <Card>
          <SectionTitle>Web 版</SectionTitle>
          <Row
            title="Web 版を開く"
            sub="明細・分析・カテゴリ・目標などは、いまは Web 版で"
            onPress={() => void Linking.openURL(env.apiBaseUrl)}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  title: { fontSize: type.large, fontWeight: '700', paddingTop: 8 },
});
