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
  type ThemePreset,
} from '@/lib/color-theme';

const GROUPS = [
  { group: 'light', title: '明るい' },
  { group: 'dark', title: '暗い' },
] as const;

export function ThemePicker() {
  const [theme, setTheme] = useState<ColorTheme>(() =>
    typeof window === 'undefined' ? { id: 'system' } : readColorTheme(),
  );
  const custom = theme.id === 'custom' && 'colors' in theme ? theme.colors : DEFAULT_CUSTOM;

  function choose(next: ColorTheme) {
    setTheme(next);
    writeColorTheme(next);
  }

  function setCustom(partial: Partial<ThemeColors>) {
    choose({ id: 'custom', colors: { ...custom, ...partial } });
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => choose({ id: 'system' })}
        aria-pressed={theme.id === 'system'}
        className="min-h-11 w-full rounded-2xl px-4 text-left text-sm font-semibold"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          boxShadow: theme.id === 'system' ? 'inset 0 0 0 2px var(--accent)' : 'var(--card-shadow)',
        }}
      >
        端末の設定に合わせる
      </button>

      {GROUPS.map(({ group, title }) => (
        <section key={group} aria-label={`${title}色`} className="space-y-2">
          <h2 className="px-1 text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            {title}
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            {PRESETS.filter((p) => p.group === group).map((preset) => (
              <li key={preset.id}>
                <PresetButton
                  preset={preset}
                  selected={theme.id === preset.id}
                  onChoose={() => choose({ id: preset.id, colors: preset.colors })}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

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
        <ColorField
          label="サブ(見込みの帯など)"
          value={custom.sub ?? custom.accent}
          onChange={(sub) => setCustom({ sub })}
        />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          補足の文字・線・帯の色は、読める濃さになるよう自動で作ります。
        </p>
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

/** プリセットの見本:背景の上にカード、文字・強調・サブを小さく並べる。 */
function PresetButton({
  preset,
  selected,
  onChoose,
}: {
  preset: ThemePreset;
  selected: boolean;
  onChoose: () => void;
}) {
  const { plane, surface, ink, accent, sub } = preset.colors;
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={selected}
      aria-label={`${preset.label}(${preset.note})`}
      className="min-h-11 w-full overflow-hidden rounded-2xl text-left"
      style={{
        background: plane,
        boxShadow: selected ? `0 0 0 3px ${accent}` : 'var(--card-shadow)',
      }}
    >
      <span className="block p-3">
        <span
          aria-hidden
          className="flex items-center justify-between rounded-xl px-3 py-2"
          style={{ background: surface }}
        >
          <span className="text-base font-semibold" style={{ color: ink }}>
            Aa
          </span>
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: accent }} />
            <span className="size-3 rounded-full" style={{ background: sub ?? accent }} />
          </span>
        </span>
        <span className="mt-2 flex items-center gap-1">
          <span className="text-sm font-semibold" style={{ color: ink }}>
            {preset.label}
          </span>
          {selected ? (
            <span className="text-xs font-semibold" style={{ color: accent }}>
              選択中
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-xs leading-snug" style={{ color: ink }}>
          {preset.note}
        </span>
      </span>
    </button>
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
