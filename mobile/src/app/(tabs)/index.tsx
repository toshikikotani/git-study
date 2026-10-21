/**
 * 今日(Web 版の今日の画面と同じ数字、ADR-131・132):今日の目安をいちばん上に、その下に今日やること・
 * 今期の見通し・今日の記録。右下の「＋」で記録する(撮る・写真から・手で入れる)。
 * 答え合わせ・入力待ちのレシート・給料日は、次の段階でこのアプリの中に作る(いまは Web 版を開く)。
 */
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MobileToday } from '@/features/mobile/contract';
import { Card, Row, SectionTitle } from '~/components/ui';
import { env } from '~/lib/env';
import { formatYen } from '~/lib/format';
import { radius, type, usePalette } from '~/lib/theme';
import { useRemote } from '~/lib/use-remote';

const openWeb = (path: string) => void Linking.openURL(`${env.apiBaseUrl}${path}`);

export default function Today() {
  const c = usePalette();
  const { data, error, refreshing, reload } = useRemote<MobileToday>('/api/mobile/today');

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: c.plane }]}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />}
      >
        <Text style={[styles.title, { color: c.ink }]}>今日</Text>
        {error && !data ? <Text style={[styles.note, { color: c.over }]}>{error}</Text> : null}
        {data ? <TodayBody today={data} /> : null}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="記録する"
        onPress={() => router.push('/record')}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: c.action, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.fabText, { color: c.onAction }]}>＋</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function TodayBody({ today }: { today: MobileToday }) {
  const c = usePalette();
  const { allowance, todo, outlook } = today;
  const hasTodo = todo.checkCount > 0 || todo.capturesCount > 0 || todo.payday;
  return (
    <View style={styles.stack}>
      <Card style={styles.hero}>
        <View style={styles.heroHead}>
          <Text style={[styles.heroLabel, { color: c.inkMuted }]}>今日の目安</Text>
          {today.provisional ? (
            <Text style={[styles.badge, { color: c.inkMuted, backgroundColor: c.plane }]}>
              記録が少ないので仮
            </Text>
          ) : null}
        </View>
        {allowance ? (
          <>
            <Text
              style={[styles.heroAmount, { color: allowance.kind === 'left' ? c.ink : c.over }]}
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {allowance.yen.toLocaleString('ja-JP')}
              <Text style={styles.heroUnit}>
                {allowance.kind === 'left' ? '円 使えます' : '円 こえています'}
              </Text>
            </Text>
            {today.tomorrowYen !== null ? (
              <View style={[styles.tomorrow, { backgroundColor: c.plane }]}>
                <Text style={[styles.note, { color: c.inkSecondary }]}>明日からの目安</Text>
                <Text style={[styles.tomorrowYen, { color: c.ink }]}>
                  1日 {formatYen(today.tomorrowYen, { sign: 'never' })}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={[styles.note, { color: c.inkSecondary }]}>
            目標(カテゴリごとの額)を決めると、今日使える目安を出せます。目標は Web
            版の「分析」で決められます。
          </Text>
        )}
      </Card>

      {hasTodo ? (
        <Card>
          <SectionTitle>今日やること</SectionTitle>
          {todo.checkCount > 0 ? (
            <Row
              title={`今日の答え合わせ ${todo.checkCount}件`}
              sub="自動で入った記録を確かめる(Web 版で開きます)"
              onPress={() => openWeb('/?check=today')}
            />
          ) : null}
          {todo.capturesCount > 0 ? (
            <Row
              divider={todo.checkCount > 0}
              title={`レシート${todo.capturesCount}件が入力待ち`}
              sub="画像を見ながら入力する(Web 版で開きます)"
              onPress={() => openWeb('/spending/review')}
            />
          ) : null}
          {todo.payday ? (
            <Row
              divider={todo.checkCount > 0 || todo.capturesCount > 0}
              title="給料日です"
              sub="入った額から振り分けを出す(Web 版で開きます)"
              onPress={() => openWeb('/settings')}
            />
          ) : null}
        </Card>
      ) : null}

      {outlook ? (
        <Card style={styles.pad}>
          <Text style={[styles.cardTitle, { color: c.ink }]}>今期の見通し</Text>
          <Text style={[styles.note, { color: c.inkMuted }]}>{outlook.periodLabel}</Text>
          <Text style={[styles.outlookAmount, { color: c.ink }]}>
            約{formatYen(outlook.p50Yen, { sign: 'never' })}
            <Text style={[styles.note, { color: c.inkMuted }]}>
              {' '}
              / 目標 {formatYen(outlook.budgetYen, { sign: 'never' })}
            </Text>
          </Text>
          <Gauge spent={outlook.spentYen} p50={outlook.p50Yen} budget={outlook.budgetYen} />
          <Text style={[styles.note, { color: c.inkMuted }]}>
            使った額 {formatYen(outlook.spentYen, { sign: 'never' })}
            {outlook.probWithin !== null
              ? ` · 目標内の確率 ${Math.round(outlook.probWithin * 100)}%`
              : ''}
          </Text>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>今日の記録</SectionTitle>
        {today.records.length === 0 ? (
          <Text style={[styles.empty, { color: c.inkMuted }]}>
            まだありません。右下の＋で記録できます。
          </Text>
        ) : (
          today.records.map((r, i) => (
            <Row
              key={r.id}
              divider={i > 0}
              title={r.label}
              sub={r.genreName ?? '未分類'}
              right={
                <Text style={[styles.recordAmount, { color: r.amountYen > 0 ? c.income : c.ink }]}>
                  {r.amountYen > 0 ? '+' : ''}
                  {formatYen(Math.abs(r.amountYen), { sign: 'never' })}
                </Text>
              }
            />
          ))
        )}
      </Card>
    </View>
  );
}

/** 使った額(塗り)と見込みの印、目標の目盛り。 */
function Gauge({ spent, p50, budget }: { spent: number; p50: number; budget: number }) {
  const c = usePalette();
  const max = Math.max(spent, p50, budget, 1);
  const pct = (yen: number) => `${Math.min(100, Math.max(0, (yen / max) * 100))}%` as const;
  return (
    <View style={styles.gauge}>
      <View style={[styles.gaugeTrack, { backgroundColor: c.track }]} />
      <View style={[styles.gaugeFill, { width: pct(spent), backgroundColor: c.accent }]} />
      <View style={[styles.gaugeTick, { left: pct(budget), backgroundColor: c.ink }]} />
      <View
        style={[
          styles.gaugeMark,
          {
            left: pct(p50),
            borderColor: p50 > budget ? c.caution : c.ink,
            backgroundColor: c.surface,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 120, gap: 16 },
  stack: { gap: 16 },
  title: { fontSize: type.large, fontWeight: '700', paddingTop: 8 },
  note: { fontSize: type.footnote, lineHeight: 18 },
  hero: { padding: 20, gap: 8 },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroLabel: { fontSize: type.subhead, fontWeight: '600' },
  badge: {
    fontSize: type.caption,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  heroAmount: { fontSize: 56, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heroUnit: { fontSize: type.title3, fontWeight: '700' },
  tomorrow: {
    marginTop: 8,
    borderRadius: radius.row,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tomorrowYen: { fontSize: type.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pad: { padding: 20, gap: 4 },
  cardTitle: { fontSize: type.body, fontWeight: '600' },
  outlookAmount: {
    fontSize: type.title1,
    fontWeight: '700',
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  gauge: { height: 28, marginVertical: 8, justifyContent: 'center' },
  gaugeTrack: { position: 'absolute', left: 0, right: 0, height: 12, borderRadius: radius.full },
  gaugeFill: { position: 'absolute', left: 0, height: 12, borderRadius: radius.full },
  gaugeTick: { position: 'absolute', width: 2, height: 24, marginLeft: -1 },
  gaugeMark: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: radius.full,
    borderWidth: 3,
  },
  empty: { fontSize: type.subhead, paddingHorizontal: 16, paddingVertical: 16 },
  recordAmount: { fontSize: type.subhead, fontWeight: '600', fontVariant: ['tabular-nums'] },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabText: { fontSize: 30, fontWeight: '500', marginTop: -2 },
});
