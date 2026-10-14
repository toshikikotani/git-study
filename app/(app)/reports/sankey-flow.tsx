'use client';

import { genreColorVar } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';

export type SankeyGenre = {
  name: string;
  spentYen: number;
};

const MAX_TARGETS = 7;
const NODE_WIDTH = 20;
const GAP = 6;
const PADDING_X = 12;
const PADDING_Y = 8;

/**
 * 今月のお金の流れをサンキーダイアグラムで表示する。
 * 左に収入（または支出合計）、右にジャンル別支出。
 * 収入が支出を上回る場合は「残り」ノードを追加する。
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

  // データが無い場合は空状態を表示
  if (positive.length === 0 && incomeYen <= 0) {
    return (
      <section
        className="glass space-y-3 rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        aria-label="今月のお金の流れ"
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          今月のお金の流れ
        </h2>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          今月の収支記録がまだありません。
        </p>
      </section>
    );
  }

  const sourceValue = Math.max(incomeYen, totalSpent);
  const sourceLabel = incomeYen > 0 ? '収入' : '支出合計';

  // 上位ジャンルを残し、小さいものは「その他」にまとめる
  const sorted = [...positive].sort((a, b) => b.spentYen - a.spentYen);
  const top = sorted.slice(0, MAX_TARGETS);
  const rest = sorted.slice(MAX_TARGETS);
  const restYen = rest.reduce((sum, g) => sum + g.spentYen, 0);

  const targets: { name: string; value: number; color: string }[] = top.map((g) => ({
    name: g.name || '未分類',
    value: g.spentYen,
    color: genreColorVar(g.name),
  }));
  if (restYen > 0) {
    targets.push({
      name: 'その他',
      value: restYen,
      color: 'var(--ink-muted)',
    });
  }

  // 収入が支出を上回る場合の残り
  const surplus = incomeYen > totalSpent ? incomeYen - totalSpent : 0;
  if (surplus > 0) {
    targets.push({
      name: '残り',
      value: surplus,
      color: 'var(--state-ok)',
    });
  }

  if (targets.length === 0) {
    return (
      <section
        className="glass space-y-3 rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        aria-label="今月のお金の流れ"
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          今月のお金の流れ
        </h2>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          表示できる支出がありません。
        </p>
      </section>
    );
  }

  const totalTarget = targets.reduce((sum, t) => sum + t.value, 0);
  if (totalTarget <= 0) return null;

  // レイアウト計算
  const height = Math.max(240, targets.length * 40 + 32);
  const width = 400;
  const leftX = PADDING_X;
  const rightX = width - PADDING_X - NODE_WIDTH;
  const usableHeight = height - PADDING_Y * 2;

  // 右側ノードの高さと位置
  const targetLayouts = targets.map((t) => ({
    ...t,
    h: Math.max(16, (t.value / totalTarget) * usableHeight * 0.9),
  }));
  const totalTargetH = targetLayouts.reduce((sum, t) => sum + t.h, 0);
  const gapTotal = GAP * Math.max(0, targetLayouts.length - 1);
  const scale = totalTargetH > 0 ? (usableHeight - gapTotal) / totalTargetH : 1;

  type Node = {
    name: string;
    value: number;
    color: string;
    y: number;
    h: number;
  };

  const rightNodes: Node[] = [];
  let yCursor = PADDING_Y;
  for (const t of targetLayouts) {
    const h = t.h * scale;
    rightNodes.push({ name: t.name, value: t.value, color: t.color, y: yCursor, h });
    yCursor += h + GAP;
  }

  // 左側ノード（収入 / 支出合計）
  const sourceH = Math.min(
    usableHeight * 0.9,
    rightNodes.reduce((sum, n) => sum + n.h, 0),
  );
  const sourceY = PADDING_Y + (usableHeight - sourceH) / 2;

  // リンク
  const linkThicknesses = rightNodes.map((node) =>
    Math.max(3, (node.value / Math.max(sourceValue, 1)) * sourceH),
  );
  const links = rightNodes.map((node, i) => {
    const thickness = linkThicknesses[i]!;
    const offset = linkThicknesses.slice(0, i).reduce((sum, t) => sum + t, 0);
    const y0 = sourceY + offset + thickness / 2;
    const y1 = node.y + node.h / 2;
    const x0 = leftX + NODE_WIDTH;
    const x1 = rightX;
    const midX = (x0 + x1) / 2;
    const d = `M ${x0} ${y0} C ${midX} ${y0}, ${midX} ${y1}, ${x1} ${y1}`;
    return {
      d,
      thickness,
      color: node.color,
      name: node.name,
      value: node.value,
    };
  });

  return (
    <section
      className="glass space-y-3 rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      aria-label="今月のお金の流れ"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          今月のお金の流れ
        </h2>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        左が{sourceLabel}、右がジャンル別の支出です。線の太さは金額の比率を表しています。
        {surplus > 0 ? `収入が支出を上回った分は「残り」として表示しています。` : ''}
      </p>

      <div className="w-full overflow-x-auto" style={{ minHeight: height }}>
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
              strokeWidth={link.thickness}
              strokeOpacity={0.6}
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
            width={NODE_WIDTH}
            height={sourceH}
            rx={4}
            fill="var(--accent)"
            opacity={0.9}
          />
          <text
            x={leftX + NODE_WIDTH / 2}
            y={sourceY + sourceH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--on-action)"
            fontSize={12}
            fontWeight={600}
            transform={`rotate(-90 ${leftX + NODE_WIDTH / 2} ${sourceY + sourceH / 2})`}
          >
            {sourceLabel}
          </text>

          {rightNodes.map((node, i) => (
            <g key={i}>
              <rect
                x={rightX}
                y={node.y}
                width={NODE_WIDTH}
                height={node.h}
                rx={3}
                fill={node.color}
                opacity={0.95}
              />
              <text
                x={rightX - 8}
                y={node.y + node.h / 2 - 4}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--ink)"
                fontSize={12}
                fontWeight={500}
              >
                {node.name.length > 10 ? `${node.name.slice(0, 9)}…` : node.name}
              </text>
              <text
                x={rightX - 8}
                y={node.y + node.h / 2 + 10}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--ink-secondary)"
                fontSize={10}
                className="tabular"
              >
                {formatYen(node.value, { sign: 'never' })}
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
