'use client';

import { genreColorVar } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';

export type SankeyGenre = {
  name: string;
  spentYen: number;
};

const MAX_TARGETS = 7;
const NODE_WIDTH = 18;
const GAP = 8;
const PADDING_X = 16;
const PADDING_Y = 12;

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
  if (positive.length === 0 && incomeYen <= 0) return null;

  const totalSpent = positive.reduce((sum, g) => sum + g.spentYen, 0);
  const sourceValue = Math.max(incomeYen, totalSpent);
  const sourceLabel = incomeYen > 0 ? '収入' : '支出合計';

  // 上位ジャンルを残し、小さいものは「その他」にまとめる
  const sorted = [...positive].sort((a, b) => b.spentYen - a.spentYen);
  const top = sorted.slice(0, MAX_TARGETS);
  const rest = sorted.slice(MAX_TARGETS);
  const restYen = rest.reduce((sum, g) => sum + g.spentYen, 0);

  const targets: { name: string; value: number; color: string }[] = top.map((g) => ({
    name: g.name,
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

  if (targets.length === 0) return null;

  const totalTarget = targets.reduce((sum, t) => sum + t.value, 0);
  if (totalTarget <= 0) return null;

  // レイアウト計算
  const height = Math.max(280, targets.length * 36 + 40);
  const width = 360;
  const leftX = PADDING_X;
  const rightX = width - PADDING_X - NODE_WIDTH;
  const usableHeight = height - PADDING_Y * 2;

  // 右側ノードの高さと位置
  const targetLayouts = targets.map((t) => {
    const h = Math.max(14, (t.value / totalTarget) * usableHeight * 0.92);
    return { ...t, h };
  });
  const totalTargetH = targetLayouts.reduce((sum, t) => sum + t.h, 0);
  const gapTotal = GAP * Math.max(0, targetLayouts.length - 1);
  const scale = (usableHeight - gapTotal) / totalTargetH;
  let yCursor = PADDING_Y;
  const rightNodes = targetLayouts.map((t) => {
    const h = t.h * scale;
    const node = { ...t, y: yCursor, h };
    yCursor += h + GAP;
    return node;
  });

  // 左側ノード（収入 / 支出合計）
  const sourceH = Math.min(usableHeight * 0.85, rightNodes.reduce((sum, n) => sum + n.h, 0));
  const sourceY = PADDING_Y + (usableHeight - sourceH) / 2;

  // リンク（左ノードから各右ノードへの曲線）
  let linkY = sourceY;
  const links = rightNodes.map((node) => {
    const thickness = Math.max(2, (node.value / sourceValue) * sourceH);
    const y0 = linkY + thickness / 2;
    linkY += thickness;
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
        左が{sourceLabel}、右がジャンル別の支出です。
        線の太さは金額の比率を表しています。
        {surplus > 0 ? `収入が支出を上回った分は「残り」として表示しています。` : ''}
      </p>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${sourceLabel}からジャンル別支出への流れ`}
          style={{ maxWidth: '100%' }}
        >
          {/* リンク */}
          {links.map((link, i) => (
            <path
              key={i}
              d={link.d}
              fill="none"
              stroke={link.color}
              strokeWidth={link.thickness}
              strokeOpacity={0.55}
              strokeLinecap="round"
            >
              <title>
                {link.name}: {formatYen(link.value, { sign: 'never' })}
              </title>
            </path>
          ))}

          {/* 左ノード */}
          <rect
            x={leftX}
            y={sourceY}
            width={NODE_WIDTH}
            height={sourceH}
            rx={4}
            fill="var(--accent)"
            opacity={0.85}
          />
          <text
            x={leftX + NODE_WIDTH / 2}
            y={sourceY + sourceH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--on-action)"
            fontSize={11}
            fontWeight={600}
            transform={`rotate(-90 ${leftX + NODE_WIDTH / 2} ${sourceY + sourceH / 2})`}
          >
            {sourceLabel}
          </text>

          {/* 右ノードとラベル */}
          {rightNodes.map((node, i) => (
            <g key={i}>
              <rect
                x={rightX}
                y={node.y}
                width={NODE_WIDTH}
                height={node.h}
                rx={3}
                fill={node.color}
                opacity={0.9}
              />
              <text
                x={rightX - 6}
                y={node.y + node.h / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--ink)"
                fontSize={11}
                fontWeight={500}
              >
                {node.name.length > 8 ? `${node.name.slice(0, 7)}…` : node.name}
              </text>
              <text
                x={rightX - 6}
                y={node.y + node.h / 2 + 12}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--ink-secondary)"
                fontSize={9}
                className="tabular"
              >
                {formatYen(node.value, { sign: 'never' })}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular" style={{ color: 'var(--ink-secondary)' }}>
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
