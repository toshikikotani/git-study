/**
 * 記録する(下から出る画面、ADR-132)。いちばん上に「レシートを撮る」「写真から」:撮ったレシートは
 * 読み取ってそのまま記録し(LINE のレシートと同じ。答え合わせで確かめる)、結果と「取り消す」を出す。
 * 手で入れるときは金額とカテゴリ(よく使う順)、お店・メモと日付は任意。保存は右上(ADR-131)。
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  MobileGenre,
  MobileReceiptResult,
  MobileRecordResult,
  MobileUndoResult,
} from '@/features/mobile/contract';
import { Card, PrimaryButton, Row, TextButton } from '~/components/ui';
import { api, ApiError } from '~/lib/api';
import { formatYen } from '~/lib/format';
import { pickReceiptPhoto } from '~/lib/receipt-photo';
import { radius, type, usePalette } from '~/lib/theme';
import { useRemote } from '~/lib/use-remote';

/** カテゴリは、よく使う8つを先に出す(Web 版の記録するシートと同じ)。 */
const TOP_GENRES = 8;

type Photo =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'done'; result: MobileReceiptResult; undone: boolean }
  | { kind: 'error'; message: string };

export default function Record() {
  const c = usePalette();
  const genres = useRemote<MobileGenre[]>('/api/mobile/genres');
  const [amountText, setAmountText] = useState('');
  const [genreId, setGenreId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [yesterday, setYesterday] = useState(false);
  const [allGenres, setAllGenres] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Photo>({ kind: 'idle' });

  const amountYen = Number(amountText.replace(/[^\d]/g, '')) || 0;
  const shown = (genres.data ?? []).slice(0, allGenres ? undefined : TOP_GENRES);

  const save = async () => {
    if (amountYen <= 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const day = new Date(Date.now() + 9 * 3_600_000 - (yesterday ? 86_400_000 : 0));
      const result = await api<MobileRecordResult>('/api/mobile/records', {
        method: 'POST',
        body: {
          amountYen,
          genreId,
          occurredOn: day.toISOString().slice(0, 10),
          ...(label.trim() ? { label: label.trim() } : {}),
        },
      });
      if (result.error || !result.record) {
        setError(result.error ?? '保存できませんでした。');
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  const readPhoto = async (from: 'camera' | 'library') => {
    const picked = await pickReceiptPhoto(from);
    if ('canceled' in picked) return;
    if ('error' in picked) {
      setPhoto({ kind: 'error', message: picked.error });
      return;
    }
    setPhoto({ kind: 'reading' });
    try {
      const result = await api<MobileReceiptResult>('/api/mobile/receipts', {
        method: 'POST',
        body: { image: picked.base64 },
        timeoutMs: 70_000,
      });
      if (result.error) {
        setPhoto({ kind: 'error', message: result.error });
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhoto({ kind: 'done', result, undone: false });
    } catch (e) {
      setPhoto({
        kind: 'error',
        message:
          e instanceof ApiError ? e.message : '読み取れませんでした。もう一度撮ってください。',
      });
    }
  };

  const undo = async (ids: string[]) => {
    try {
      const result = await api<MobileUndoResult>('/api/mobile/records/undo', {
        method: 'POST',
        body: { ids },
      });
      if (result.error) {
        setPhoto({ kind: 'error', message: result.error });
        return;
      }
      setPhoto((p) => (p.kind === 'done' ? { ...p, undone: true } : p));
    } catch (e) {
      setPhoto({
        kind: 'error',
        message: e instanceof ApiError ? e.message : '取り消せませんでした。',
      });
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: c.plane }]}>
      <View style={styles.header}>
        <TextButton label="キャンセル" onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: c.ink }]}>記録する</Text>
        <TextButton
          label={saving ? '保存中' : '保存'}
          bold
          disabled={amountYen <= 0 || saving}
          onPress={() => void save()}
        />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.photoButtons}>
            <View style={styles.flex}>
              <PrimaryButton
                label="レシートを撮る"
                busy={photo.kind === 'reading'}
                onPress={() => void readPhoto('camera')}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={photo.kind === 'reading'}
              onPress={() => void readPhoto('library')}
              style={({ pressed }) => [
                styles.secondary,
                { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: c.ink }]}>写真から</Text>
            </Pressable>
          </View>

          <PhotoResult photo={photo} onUndo={(ids) => void undo(ids)} />

          <Card style={styles.amountCard}>
            <Text style={[styles.fieldLabel, { color: c.inkMuted }]}>手で入れる</Text>
            <View style={styles.amountRow}>
              <TextInput
                accessibilityLabel="金額(円)"
                value={amountText}
                onChangeText={(t) => {
                  const digits = t.replace(/[^\d]/g, '').slice(0, 8);
                  setAmountText(digits === '' ? '' : Number(digits).toLocaleString('ja-JP'));
                }}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={c.inkMuted}
                style={[styles.amount, { color: c.ink }]}
              />
              <Text style={[styles.amountUnit, { color: c.ink }]}>円</Text>
            </View>
          </Card>

          <View style={styles.genres}>
            {shown.map((g) => {
              const on = g.id === genreId;
              return (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setGenreId(on ? null : g.id)}
                  style={[
                    styles.genre,
                    {
                      backgroundColor: on ? c.action : c.surface,
                      borderColor: on ? c.action : c.hairline,
                    },
                  ]}
                >
                  <Text
                    style={[styles.genreText, { color: on ? c.onAction : c.ink }]}
                    numberOfLines={2}
                  >
                    {g.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {(genres.data ?? []).length > TOP_GENRES ? (
            <TextButton
              label={allGenres ? 'よく使うものだけ' : 'すべてのカテゴリ'}
              onPress={() => setAllGenres((v) => !v)}
            />
          ) : null}
          {genres.error && !genres.data ? (
            <Text style={[styles.note, { color: c.over }]}>{genres.error}</Text>
          ) : null}

          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="お店・メモ(なくてもよい)"
            placeholderTextColor={c.inkMuted}
            maxLength={60}
            style={[styles.input, { backgroundColor: c.surface, color: c.ink }]}
          />
          <View style={[styles.days, { backgroundColor: c.track }]}>
            {[
              { on: !yesterday, label: '今日', value: false },
              { on: yesterday, label: '昨日', value: true },
            ].map((d) => (
              <Pressable
                key={d.label}
                accessibilityRole="button"
                accessibilityState={{ selected: d.on }}
                onPress={() => setYesterday(d.value)}
                style={[styles.day, d.on ? { backgroundColor: c.surface } : null]}
              >
                <Text
                  style={[
                    styles.dayText,
                    { color: d.on ? c.ink : c.inkSecondary, fontWeight: d.on ? '700' : '400' },
                  ]}
                >
                  {d.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text style={[styles.note, { color: c.over }]}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PhotoResult({ photo, onUndo }: { photo: Photo; onUndo: (ids: string[]) => void }) {
  const c = usePalette();
  if (photo.kind === 'idle') return null;
  if (photo.kind === 'reading') {
    return (
      <Card style={styles.photoCard}>
        <ActivityIndicator color={c.inkMuted} />
        <Text style={[styles.note, { color: c.inkSecondary }]}>読み取っています…(10〜20秒)</Text>
      </Card>
    );
  }
  if (photo.kind === 'error') {
    return (
      <Card style={styles.photoCard}>
        <Text style={[styles.note, { color: c.over }]}>{photo.message}</Text>
      </Card>
    );
  }
  const { result, undone } = photo;
  const ids = result.records.map((r) => r.id);
  return (
    <Card>
      <Text style={[styles.photoTitle, { color: c.ink }]}>
        {undone ? '取り消しました' : 'レシートを記録しました'}
      </Text>
      {result.records.map((r, i) => (
        <Row
          key={r.id}
          divider={i > 0}
          title={r.label}
          sub={`${r.genreName ?? '未分類'} · 夜の答え合わせで確かめます`}
          right={
            <Text style={[styles.photoAmount, { color: c.ink }]}>
              {formatYen(Math.abs(r.amountYen), { sign: 'never' })}
            </Text>
          }
        />
      ))}
      {result.merged > 0 ? (
        <Text style={[styles.photoNote, { color: c.inkMuted }]}>
          カードの通知メールと同じ支払いなので、1件にまとめました。
        </Text>
      ) : null}
      {result.duplicates > 0 ? (
        <Text style={[styles.photoNote, { color: c.inkMuted }]}>
          {result.duplicates}件は取り込み済みだったので入れませんでした。
        </Text>
      ) : null}
      {!undone && ids.length > 0 && result.merged === 0 ? (
        <View style={styles.photoActions}>
          <TextButton label="取り消す" onPress={() => onUndo(ids)} />
          <TextButton label="閉じる" bold onPress={() => router.back()} />
        </View>
      ) : (
        <View style={styles.photoActions}>
          <TextButton label="閉じる" bold onPress={() => router.back()} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerTitle: { fontSize: type.body, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  photoButtons: { flexDirection: 'row', gap: 8 },
  secondary: {
    minHeight: 50,
    borderRadius: radius.full,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: type.body, fontWeight: '600' },
  photoCard: { padding: 16, gap: 8, alignItems: 'center' },
  photoTitle: { fontSize: type.body, fontWeight: '600', paddingHorizontal: 16, paddingTop: 14 },
  photoAmount: { fontSize: type.subhead, fontWeight: '600', fontVariant: ['tabular-nums'] },
  photoNote: { fontSize: type.footnote, paddingHorizontal: 16, paddingBottom: 4 },
  photoActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 8 },
  amountCard: { padding: 16 },
  fieldLabel: { fontSize: type.footnote, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 4 },
  amount: {
    flex: 1,
    textAlign: 'right',
    fontSize: 40,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minHeight: 56,
  },
  amountUnit: { fontSize: type.title2, fontWeight: '600' },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  genre: {
    width: '23%',
    flexGrow: 1,
    minHeight: 52,
    borderRadius: radius.row,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  genreText: { fontSize: type.footnote, fontWeight: '600', textAlign: 'center' },
  input: { minHeight: 48, borderRadius: radius.row, paddingHorizontal: 16, fontSize: type.body },
  days: { flexDirection: 'row', borderRadius: radius.full, padding: 2, gap: 2 },
  day: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: type.subhead },
  note: { fontSize: type.footnote, lineHeight: 18 },
});
