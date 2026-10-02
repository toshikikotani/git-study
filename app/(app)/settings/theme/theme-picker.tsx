'use client';

import { useState } from 'react';

import {
  DEFAULT_CUSTOM,
  PRESETS,
  applyColorTheme,
  readColorTheme,
  writeColorTheme,
  type ColorTheme,
  type ThemeColors,
} from '@/lib/color-theme';

export function ThemePicker() {
  const [theme, setTheme] = useState<ColorTheme>(() =>
    typeof window === 'undefined' ? { id: 'system' } : readColorTheme(),
  );
  const custom = theme.id === 'custom' ? theme.colors : DEFAULT_CUSTOM;

  function choose(next: ColorTheme) {
    setTheme(next);
    writeColorTheme(next);
  }

  function setCustom(partial: Partial<ThemeColors>) {
    choose({ id: 'custom', colors: { ...custom, ...partial } });
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => choose({ id: 'system' })}
        className="min-h-11 w-full rounded-2xl px-4 text-left text-sm font-semibold"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          boxShadow: theme.id === 'system' ? 'inset 0 0 0 2px var(--accent)' : 'var(--card-shadow)',
        }}
      >
        端末の設定に合わせる
      </button>
      <ul className="grid grid-cols-2 gap-3">
        {PRESETS.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              onClick={() => choose({ id: preset.id, colors: preset.colors })}
              className="min-h-11 w-full rounded-2xl p-3 text-left"
              style={{
                background: preset.colors.surface,
                color: preset.colors.ink,
                boxShadow:
                  theme.id === preset.id ? 'inset 0 0 0 2px var(--accent)' : 'var(--card-shadow)',
              }}
            >
              <span
                className="mb-2 block h-8 rounded-xl"
                style={{ background: preset.colors.plane }}
              />
              <span className="text-sm font-semibold">{preset.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <fieldset className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--surface)' }}>
        <legend className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          自由に混ぜる
        </legend>
        <ColorField label="背景" value={custom.plane} onChange={(plane) => setCustom({ plane })} />
        <ColorField
          label="カード"
          value={custom.surface}
          onChange={(surface) => setCustom({ surface })}
        />
        <ColorField label="文字" value={custom.ink} onChange={(ink) => setCustom({ ink })} />
        <ColorField
          label="強調"
          value={custom.accent}
          onChange={(accent) => setCustom({ accent })}
        />
        <button
          type="button"
          className="min-h-11 text-sm font-semibold"
          style={{ color: 'var(--ink-muted)' }}
          onClick={() => {
            applyColorTheme({ id: 'system' });
            setTheme({ id: 'system' });
          }}
        >
          一度やめる
        </button>
      </fieldset>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span style={{ color: 'var(--ink)' }}>{label}</span>
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-16 cursor-pointer rounded-full border-0 bg-transparent"
      />
    </label>
  );
}
