/**
 * 画面の部品(カード・行・ボタン)。Web 版と同じ型:カード16・行12・ボタンは丸、押せる場所は44pt、
 * 主のボタン=強調色の塗り、押せない=淡い面に読める濃さの文字(ADR-131)。
 */
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { radius, TAP, type, usePalette } from '~/lib/theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = usePalette();
  return <View style={[styles.card, { backgroundColor: c.surface }, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const c = usePalette();
  return <Text style={[styles.sectionTitle, { color: c.inkMuted }]}>{children}</Text>;
}

export function Row({
  title,
  sub,
  right,
  onPress,
  divider = false,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  onPress?: () => void;
  divider?: boolean;
}) {
  const c = usePalette();
  const body = (
    <View
      style={[
        styles.row,
        divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline } : null,
      ]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: c.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.rowSub, { color: c.inkMuted }]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Text style={[styles.chevron, { color: c.inkMuted }]}>›</Text> : null)}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const c = usePalette();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: off ? c.actionOff : c.action, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={c.onActionOff} />
      ) : (
        <Text style={[styles.buttonText, { color: off ? c.onActionOff : c.onAction }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** 文字だけのボタン(右上の「保存」「閉じる」など)。押せないときは薄く。 */
export function TextButton({
  label,
  onPress,
  disabled = false,
  bold = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bold?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.textButton, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.textButtonLabel, { color: c.accent, fontWeight: bold ? '700' : '400' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, overflow: 'hidden' },
  sectionTitle: {
    fontSize: type.footnote,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: type.subhead, fontWeight: '600' },
  rowSub: { fontSize: type.footnote },
  chevron: { fontSize: type.title3 },
  button: {
    minHeight: 50,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonText: { fontSize: type.body, fontWeight: '600' },
  textButton: { minHeight: TAP, minWidth: TAP, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: type.body },
});
