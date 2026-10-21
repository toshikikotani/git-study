/**
 * 色と文字の型(Web 版の既定のテーマ app/globals.css と同じ値、ADR-131・132)。端末の明るい・暗いに合わせる。
 * 主のボタン=強調色の塗り、押せない=淡い面に読める濃さの文字。超過=赤、注意=黄。
 */
import { useColorScheme } from 'react-native';

export type Palette = {
  plane: string;
  surface: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  hairline: string;
  accent: string;
  action: string;
  onAction: string;
  actionOff: string;
  onActionOff: string;
  over: string;
  overTrack: string;
  caution: string;
  cautionTrack: string;
  income: string;
  track: string;
};

const light: Palette = {
  plane: '#f2f2f7',
  surface: '#ffffff',
  ink: '#1c1c1e',
  inkSecondary: '#3a3a3c',
  inkMuted: '#6e6e73',
  hairline: '#e5e5ea',
  accent: '#5c5853',
  action: '#5c5853',
  onAction: '#ffffff',
  actionOff: '#ededf0',
  onActionOff: '#636366',
  over: '#c13c36',
  overTrack: '#fee9e6',
  caution: '#9a4a06',
  cautionTrack: '#fff1e0',
  income: '#2e7d4f',
  track: '#ededf0',
};

const dark: Palette = {
  plane: '#000000',
  surface: '#161616',
  ink: '#ededed',
  inkSecondary: '#a3adbd',
  inkMuted: '#97a1b4',
  hairline: '#262626',
  accent: '#f2f5fa',
  action: '#f2f5fa',
  onAction: '#111111',
  actionOff: '#2c2c2e',
  onActionOff: '#98989f',
  over: '#fea196',
  overTrack: '#442320',
  caution: '#f3ae58',
  cautionTrack: '#3e290f',
  income: '#7cd591',
  track: '#2c2c2e',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** 文字の大きさ(iOS の型。最小11)と角丸(カード16・行と入力12・ボタンは丸)。 */
export const type = {
  caption: 12,
  footnote: 13,
  subhead: 15,
  callout: 16,
  body: 17,
  title3: 20,
  title2: 22,
  title1: 28,
  large: 34,
} as const;

export const radius = { card: 16, row: 12, full: 999 } as const;

/** 押せる場所は 44pt 以上。 */
export const TAP = 44;
