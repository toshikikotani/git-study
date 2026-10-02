export const THEME_KEY = 'git-study-color-theme';

export type ThemeColors = {
  plane: string;
  surface: string;
  ink: string;
  accent: string;
};

export type ColorTheme =
  | { id: 'system' }
  | { id: 'kinari' | 'sumi' | 'ai' | 'koke'; colors: ThemeColors }
  | { id: 'custom'; colors: ThemeColors };

export const PRESETS: {
  id: 'kinari' | 'sumi' | 'ai' | 'koke';
  label: string;
  colors: ThemeColors;
}[] = [
  {
    id: 'kinari',
    label: '生成り',
    colors: { plane: '#f4efe6', surface: '#fffaf3', ink: '#2a241c', accent: '#8a6a3b' },
  },
  {
    id: 'sumi',
    label: '墨',
    colors: { plane: '#121418', surface: '#1c2128', ink: '#f4f1ea', accent: '#d7c4a3' },
  },
  {
    id: 'ai',
    label: '藍',
    colors: { plane: '#e7eef6', surface: '#f7fbff', ink: '#102033', accent: '#1d4e89' },
  },
  {
    id: 'koke',
    label: '苔',
    colors: { plane: '#e7f0ea', surface: '#f6fbf7', ink: '#173026', accent: '#2f6f56' },
  },
];

export const DEFAULT_CUSTOM: ThemeColors = {
  plane: '#f4efe6',
  surface: '#fffaf3',
  ink: '#2a241c',
  accent: '#8a6a3b',
};

export function isDark(plane: string): boolean {
  const hex = plane.replace('#', '');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

export function applyColorTheme(theme: ColorTheme | null): void {
  const root = document.documentElement;
  if (theme === null || theme.id === 'system') {
    root.removeAttribute('data-theme');
    root.style.removeProperty('--plane');
    root.style.removeProperty('--surface');
    root.style.removeProperty('--surface-raised');
    root.style.removeProperty('--ink');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--action');
    return;
  }
  const { plane, surface, ink, accent } = theme.colors;
  root.dataset.theme = isDark(plane) ? 'dark' : 'light';
  root.style.setProperty('--plane', plane);
  root.style.setProperty('--surface', surface);
  root.style.setProperty('--surface-raised', surface);
  root.style.setProperty('--ink', ink);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--action', accent);
}

export function readColorTheme(): ColorTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { id: 'system' };
    const parsed = JSON.parse(raw) as ColorTheme;
    if (parsed.id === 'system') return parsed;
    if (!parsed.colors) return { id: 'system' };
    return parsed;
  } catch {
    return { id: 'system' };
  }
}

export function writeColorTheme(theme: ColorTheme): void {
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  applyColorTheme(theme);
}

export const THEME_BOOT = `(function(){try{var raw=localStorage.getItem('${THEME_KEY}');if(!raw)return;var t=JSON.parse(raw);if(!t||t.id==='system'||!t.colors)return;var c=t.colors;var hex=(c.plane||'').replace('#','');var dark=false;if(hex.length===6){var r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);dark=(r*299+g*587+b*114)/1000<140;}var root=document.documentElement;root.dataset.theme=dark?'dark':'light';root.style.setProperty('--plane',c.plane);root.style.setProperty('--surface',c.surface);root.style.setProperty('--surface-raised',c.surface);root.style.setProperty('--ink',c.ink);root.style.setProperty('--accent',c.accent);root.style.setProperty('--action',c.accent);}catch(e){}})();`;
