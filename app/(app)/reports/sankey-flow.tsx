'use client';

import { genreColorVar } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';

export type SankeyGenre = {
  name: string;
  spentYen: number;
};

const MAX_TARGETS = 7;
const NODE_W = 14;
const GAP = 6;
const PAD_X = 8;
const PAD_Y = 4;

/**
 * 今月のお金の流れをサンキーダイアグラムで表示する。
 * 左: 収入（または支出合計） / 右: ジャンル別支出 + 残り
 */
export function SankeyFlow({
  incomeYen,
  genres,
}: {
  incomeYen: number;
  genres: readonly SankeyGenre[];
}) {
  const positive = genres.filter((g) => g.spentYen > 0);
  const totalSpent = positive.reduce((sum, g) => sum + g.spentYen, 0);

  if (positive.length === 0 && incomeYen <= 0) {
    return (
      <section
        className="glass space-y-2 rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          今月のお金の流れ
        </h2>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          今月の収支記録がまだありません。
        </p>
      </section>
    );
  }

  const sourceValue = Math.max(incomeYen, totalSpent);
  const sourceLabel = incomeYen > 0 ? '収入' : '支出合計';

  const sorted = [...positive].sort((a, b) => b.spentYen - a.spentYen);
  const top = sorted.slice(0, MAX_TARGETS);
  const restYen = sorted.slice(MAX_TARGETS).reduce((sum, g) => sum + g.spentYen, 0);

  const targets: { name: string; value: number; color: string }[] = top.map((g) => ({
    name: g.name || '未分類',
    value: g.spentYen,
    color: genreColorVar(g.name),
  }));
  if (restYen > 0) {
    targets.push({ name: 'その他', value: restYen, color: 'var(--ink-muted)' });
  }
  const surplus = incomeYen > totalSpent ? incomeYen - totalSpent : 0;
  if (surplus > 0) {
    targets.push({ name: '残り', value: surplus, color: 'var(--state-ok)' });
  }

  if (targets.length === 0) return null;

  const totalTarget = targets.reduce((sum, t) => sum + t.value, 0);
  if (totalTarget <= 0) return null;

  // レイアウト
  const width = 360;
  const rowH = 36;
  const height = Math.max(220, targets.length * rowH + PAD_Y * 2);
  const leftX = PAD_X;
  const rightX = width - PAD_X - NODE_W;
  const usableH = height - PAD_Y * 2;

  // 右ノードの高さとY位置（変数再代入を避ける）
  const rawHeights = targets.map((t) =>
    Math.max(14, (t.value / totalTarget) * usableH * 0.88),
  );
  const rawSum = rawHeights.reduce((s, h) => s + h, 0);
  const gapSum = GAP * Math.max(0, targets.length - 1);
  const scale = rawSum > 0 ? (usableH - gapSum) / rawSum : 1;

  const rightNodes = targets.map((t, i) => {
    const h = rawHeights[i]! * scale;
    const y =
      PAD_Y +
      rawHeights.slice(0, i).reduce((s, rh) => s + rh * scale + GAP, 0);
    return { ...t, y, h };
  });

  // 左ノード
  const sourceH = Math.min(
    usableH * 0.92,
    rightNodes.reduce((s, n) => s + n.h, 0),
  );
  const sourceY = PAD_Y + (usableH - sourceH) / 2;

  // リンク（左から右への曲線）
  const thicknesses = rightNodes.map((n) =>
    Math.max(2, (n.value / Math.max(sourceValue, 1)) * sourceH),
  );
  const links = rightNodes.map((n, i) => {
    const thick = thicknesses[i]!;
    const yOffset = thicknesses.slice(0, i).reduce((s, t) => s + t, 0);
    const y0 = sourceY + yOffset + thick / 2;
    const y1 = n.y + n.h / 2;
    const x0 = leftX + NODE_W;
    const x1 = rightX;
    const mx = (x0 + x1) / 2;
    const d = `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
    return { d, thick, color: n.color, name: n.name, value: n.value };
  });

  return (
    <section
      className="glass space-y-3 rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
        今月のお金の流れ
      </h2>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        左が{sourceLabel}、右がジャンル別支出です。線の太さは金額の比率を表しています。
      </p>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${sourceLabel}からジャンル別支出への流れ`}
          style={{ display: 'block', maxWidth: '100%' }}
        >
          {links.map((link, i) => (
            <path
              key={i}
              d={link.d}
              fill="none"
              stroke={link.color}
              strokeWidth={link.thick}
              strokeOpacity={0.55}
              strokeLinecap="round"
            >
              <title>
                {link.name}: {formatYen(link.value, { sign: 'never' })}
              </title>
            </path>
          ))}

          <rect
            x={leftX}
            y={sourceY}
            width={NODE_W}
            height={sourceH}
            rx={3}
            fill="var(--accent)"
            opacity={0.9}
          />
          <text
            x={leftX + NODE_W / 2}
            y={sourceY + sourceH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--on-action)"
            fontSize={11}
            fontWeight={600}
            transform={`rotate(-90 ${leftX + NODE_W / 2} ${sourceY + sourceH / 2})`}
          >
            {sourceLabel}
          </text>

          {rightNodes.map((n, i) => (
            <g key={i}>
              <rect
                x={rightX}
                y={n.y}
                width={NODE_W}
                height={n.h}
                rx={3}
                fill={n.color}
                opacity={0.95}
              />
              <text
                x={rightX - 6}
                y={n.y + n.h / 2 - 5}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--ink)"
                fontSize={11}
                fontWeight={500}
              >
                {n.name.length > 8 ? `${n.name.slice(0, 7)}…` : n.name}
              </text>
              <text
                x={rightX - 6}
                y={n.y + n.h / 2 + 8}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--ink-secondary)"
                fontSize={9}
                className="tabular"
              >
                {formatYen(n.value, { sign: 'never' })}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <span>
          {sourceLabel}:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {formatYen(sourceValue, { sign: 'never' })}
          </strong>
        </span>
        <span>
          支出合計:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {formatYen(totalSpent, { sign: 'never' })}
          </strong>
        </span>
        {surplus > 0 ? (
          <span>
            残り:{' '}
            <strong style={{ color: 'var(--state-ok)' }}>
              {formatYen(surplus, { sign: 'never' })}
            </strong>
          </span>
        ) : null}
      </div>
    </section>
  );
}
