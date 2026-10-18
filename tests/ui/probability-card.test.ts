import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probabilityAt, type ForecastDistribution } from '@/domain/forecast/distribution';
import { formatProbability } from '@/domain/forecast/format';
import { createHookState } from '../helpers/hook-state';

const state = vi.hoisted(() => ({ host: null as ReturnType<typeof createHookState> | null }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
}));

import { ProbabilityCard } from '../../app/(app)/reports/probability-card';

type Props = {
  children?: ReactNode;
  role?: string;
  type?: string;
  className?: string;
  'aria-label'?: string;
  'aria-valuetext'?: string;
  'aria-pressed'?: boolean;
  'data-left-probability'?: number;
  'data-right-probability'?: number;
  'data-single-amount'?: number;
  'data-atom-probability'?: number;
  min?: number;
  max?: number;
  value?: number;
  d?: string;
  fill?: string;
  stroke?: string;
  y1?: number;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  onPointerDown?: (event: {
    pointerId: number;
    clientX: number;
    currentTarget: {
      setPointerCapture: ReturnType<typeof vi.fn>;
      getBoundingClientRect: () => { left: number; width: number };
    };
  }) => void;
};
function nodes(tree: ReactNode) {
  const pending = [tree];
  const result: { type: unknown; props: Props }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isValidElement<Props>(node)) continue;
    result.push(node);
    pending.push(node.props.children);
  }
  return result;
}
function text(tree: ReactNode): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return isValidElement<Props>(tree) ? text(tree.props.children) : '';
}
const defaultDistribution: ForecastDistribution = {
  amounts: [120000, 155000, 210000, 230000, 255000, 310000, 350000],
  calibration: null,
};
const skewed: ForecastDistribution = {
  amounts: [...Array.from({ length: 998 }, (_, i) => 210000 + i * 100), 800000, 935000],
  calibration: null,
};
function render(distribution = defaultDistribution, budgetYen = 189000, provisional = false) {
  state.host!.begin();
  return ProbabilityCard({
    distribution,
    p50: distribution.amounts[Math.floor(distribution.amounts.length / 2)] ?? 0,
    budgetYen,
    provisional,
  });
}
const range = (tree: ReactNode) => nodes(tree).find((node) => node.props.type === 'range')!.props;
const svg = (tree: ReactNode) => nodes(tree).find((node) => node.type === 'svg')!.props;
const button = (tree: ReactNode, label: string) =>
  nodes(tree).find((node) => node.type === 'button' && text(node.props.children) === label)!.props;
const status = (tree: ReactNode) =>
  text(nodes(tree).find((node) => node.props.role === 'status')?.props.children);
const header = (tree: ReactNode) =>
  text(nodes(tree).find((node) => node.props.className?.includes('text-[28px]'))?.props.children);

/** SVGに渡した二次Bezierそのものを積分し、塗られた面積の割合を確認する。 */
function coloredFraction(tree: ReactNode) {
  const fills = nodes(tree).filter((node) => node.type === 'path' && node.props.fill !== 'none');
  const area = (props: Props) => {
    const points = props.d!.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)!.map(Number);
    const base = points[1]!;
    return (
      ((points[6]! - points[2]!) * (base - points[3]! + base - points[5]! + base - points[7]!)) / 3
    );
  };
  const total = fills.reduce((sum, fill) => sum + area(fill.props), 0);
  if (total === 0) return 0;
  return (
    fills
      .filter((fill) => fill.props.fill === 'var(--accent)')
      .reduce((sum, fill) => sum + area(fill.props), 0) / total
  );
}
function probabilityIncludingTails(tree: ReactNode) {
  const left = svg(tree)['data-left-probability']!;
  const right = svg(tree)['data-right-probability']!;
  const atoms = nodes(tree).filter((node) => node.props['data-atom-probability'] !== undefined);
  const mass = (node: { props: Props }) => node.props['data-atom-probability']!;
  const atomTotal = atoms.reduce((sum, atom) => sum + mass(atom), 0);
  const coloredAtoms = atoms
    .filter((atom) => atom.props.stroke === 'var(--accent)')
    .reduce((sum, atom) => sum + mass(atom), 0);
  return left + coloredAtoms + coloredFraction(tree) * (1 - left - right - atomTotal);
}

beforeEach(() => {
  state.host = createHookState();
});

describe('見やすい範囲へ拡大した滑らかな予測分布(ADR-123)', () => {
  it('滑らかな曲線でも、見出し・塗った面積・選択した金額の確率が一致する', () => {
    const distribution: ForecastDistribution = {
      amounts: [100000, 100000, 110000, 110000, 110000, 120000, 120000, 500000],
      calibration: { pit: [0.1, 0.5, 0.8], pitWeight: 0.25 },
    };
    const target = 113879;
    let tree = render(distribution, target);
    const probability = probabilityAt(distribution, target);
    expect(header(tree)).toBe(formatProbability(probability));
    expect(nodes(tree).some((node) => node.type === 'rect')).toBe(false);
    expect(nodes(tree).some((node) => node.props.d?.includes('Q'))).toBe(true);
    expect(probabilityIncludingTails(tree)).toBeCloseTo(probability, 12);
    range(tree).onChange!({ target: { value: String(target) } });
    tree = render(distribution, target);
    expect(status(tree)).toBe(`113,879円以下になる確率 ${formatProbability(probability)}`);
    expect(range(tree)['aria-valuetext']).toBe(status(tree));
  });

  it('まれな93.5万円で中心を潰さず、拡大で省いた裾も確率に含める', () => {
    let tree = render(skewed, 255000);
    const focusWidth = range(tree).max! - range(tree).min!;
    const probability = probabilityAt(skewed, 255000);
    expect(button(tree, '主な範囲')['aria-pressed']).toBe(true);
    expect(svg(tree)['data-left-probability']).toBeGreaterThan(0);
    expect(svg(tree)['data-right-probability']).toBeGreaterThan(0);
    expect(text(tree)).toContain(
      `表示外：低い側${formatProbability(svg(tree)['data-left-probability']!)}・高い側${formatProbability(svg(tree)['data-right-probability']!)}`,
    );
    expect(probabilityIncludingTails(tree)).toBeCloseTo(probability, 12);
    expect(text(tree)).toContain('範囲外も確率に含みます。');
    button(tree, '全体').onClick!();
    tree = render(skewed, 255000);
    expect(button(tree, '全体')['aria-pressed']).toBe(true);
    expect(range(tree).max).toBeGreaterThanOrEqual(935000);
    expect(focusWidth).toBeLessThan((range(tree).max! - range(tree).min!) / 4);
    expect(header(tree)).toBe(formatProbability(probability));
    expect(probabilityIncludingTails(tree)).toBeCloseTo(probability, 12);
    expect(text(tree)).not.toContain('範囲外も確率に含みます。');
  });

  it('全体で選んだ金額は拡大へ戻しても変えず、範囲外だと明示する', () => {
    let tree = render(skewed);
    button(tree, '全体').onClick!();
    tree = render(skewed);
    range(tree).onChange!({ target: { value: '800000' } });
    tree = render(skewed);
    expect(status(tree)).toBe('800,000円以下になる確率 99%以上');
    button(tree, '主な範囲').onClick!();
    tree = render(skewed);
    expect(status(tree)).toBe('→ 800,000円以下になる確率 99%以上（表示範囲外）');
    expect(range(tree).value).toBe(range(tree).max);
    expect(range(tree)['aria-valuetext']).not.toContain('800,000円以下');
    expect(range(tree)['aria-valuetext']).toContain(
      String(range(tree).value!.toLocaleString('ja-JP')),
    );
    button(tree, '全体').onClick!();
    tree = render(skewed);
    expect(range(tree).value).toBe(800000);
    expect(status(tree)).toBe('800,000円以下になる確率 99%以上');
  });

  it('選択額を動かしても山の形を変えず、確率は元の分布から読む', () => {
    let tree = render(skewed, 255000);
    const paths = (current: ReactNode) =>
      nodes(current)
        .filter((node) => node.type === 'path')
        .map((node) => node.props.d);
    const initialPaths = paths(tree);
    for (const yen of [230001, 255017, 290009]) {
      range(tree).onChange!({ target: { value: String(yen) } });
      tree = render(skewed, 255000);
      expect(paths(tree)).toEqual(initialPaths);
      expect(status(tree)).toBe(
        `${yen.toLocaleString('ja-JP')}円以下になる確率 ${formatProbability(probabilityAt(skewed, yen))}`,
      );
    }
  });

  it.each([10000, 1500000])('範囲外の目標%d円は矢印で示し、見込みの金額も隠さない', (budget) => {
    const tree = render(skewed, budget);
    expect(text(tree)).toContain('見込み（中央）');
    expect(text(tree)).toContain('26.0万円');
    expect(text(tree)).toContain(`目標は表示範囲より${budget < 210000 ? '左' : '右'}にあります。`);
    expect(header(tree)).toBe(formatProbability(probabilityAt(skewed, budget)));
    const markup = renderToStaticMarkup(tree);
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it('目標と見込みが同じ位置でも、両方のラベルを表示する', () => {
    const tree = render(defaultDistribution, 230000);
    expect(text(tree)).toContain('目標23.0万円');
    expect(text(tree)).toContain('見込み（中央）23.0万円');
  });

  it('最小額に50%集中しても細い山を作らず、点の確率と残りの曲線を分ける', () => {
    const distribution: ForecastDistribution = {
      amounts: [
        ...Array<number>(500).fill(100000),
        ...Array.from({ length: 500 }, (_, i) => 150000 + i * 500),
      ],
      calibration: null,
    };
    const tree = render(distribution, 100000);
    const atom = nodes(tree).find((node) => node.props['data-atom-probability'] === 0.5)!;
    expect(atom.props.y1).toBe(104 - 0.5 * 88);
    expect(atom.props.stroke).toBe('var(--accent)');
    expect(text(tree)).toContain('100,000円に50%の予測が集中しています。');
    expect(probabilityIncludingTails(tree)).toBeCloseTo(0.5, 12);
    expect(header(tree)).toBe('50%');
    expect(renderToStaticMarkup(tree)).not.toMatch(/NaN|Infinity/);
  });

  it('目標内が1%未満なら、それより低い金額の確率も1%未満になる', () => {
    const distribution: ForecastDistribution = {
      amounts: [155000, ...Array.from({ length: 999 }, (_, i) => 210000 + i * 100)],
      calibration: null,
    };
    let tree = render(distribution);
    expect(header(tree)).toBe('1%未満');
    button(tree, '全体').onClick!();
    tree = render(distribution);
    range(tree).onChange!({ target: { value: '155000' } });
    tree = render(distribution);
    expect(status(tree)).toBe('155,000円以下になる確率 1%未満');
  });

  it('ポインターを表示範囲の金額へ変換し、キーボード操作と同じ確率を出す', () => {
    let tree = render();
    const input = range(tree);
    const amount = 155000;
    const svgX = 3 + ((amount - input.min!) / (input.max! - input.min!)) * 320;
    const capture = vi.fn();
    svg(tree).onPointerDown!({
      pointerId: 1,
      clientX: 40 + svgX * 2,
      currentTarget: {
        setPointerCapture: capture,
        getBoundingClientRect: () => ({ left: 40, width: 652 }),
      },
    });
    tree = render();
    expect(capture).toHaveBeenCalledWith(1);
    expect(status(tree)).toBe('155,000円以下になる確率 29%');
    range(tree).onChange!({ target: { value: String(amount) } });
    expect(status(render())).toBe(status(tree));
  });

  it('幅0のグラフと無効な入力を無視し、範囲外の入力は端へ収める', () => {
    const tree = render();
    svg(tree).onPointerDown!({
      pointerId: 1,
      clientX: 40,
      currentTarget: {
        setPointerCapture: vi.fn(),
        getBoundingClientRect: () => ({ left: 40, width: 0 }),
      },
    });
    expect(status(render())).toBe('');
    range(tree).onChange!({ target: { value: 'Infinity' } });
    expect(status(render())).toBe('');
    range(tree).onChange!({ target: { value: '-99999999' } });
    expect(range(render()).value).toBe(range(tree).min);
    expect(status(render())).toContain('1%未満');
    range(tree).onChange!({ target: { value: '99999999' } });
    expect(range(render()).value).toBe(range(tree).max);
    expect(status(render())).toContain('99%以上');
  });

  it('全試行が同じなら、山形の幅を作らず単一額として示す', () => {
    const distribution: ForecastDistribution = { amounts: [0, 0, 0], calibration: null };
    const tree = render(distribution, 0);
    expect(header(tree)).toBe('99%以上');
    expect(nodes(tree).some((node) => node.props['data-single-amount'] === 0)).toBe(true);
    expect(nodes(tree).some((node) => node.type === 'path')).toBe(false);
    expect(text(tree)).toContain('見込みは0円に集中しています。');
    expect(renderToStaticMarkup(tree)).not.toMatch(/NaN|Infinity/);
  });

  it('返金による負の着地も、元の分布のまま確率を調べられる', () => {
    const distribution: ForecastDistribution = { amounts: [-1500, -1000, 500], calibration: null };
    let tree = render(distribution, 0);
    expect(range(tree).min).toBe(-1501);
    expect(probabilityIncludingTails(tree)).toBeCloseTo(2 / 3, 12);
    range(tree).onChange!({ target: { value: '-1000' } });
    tree = render(distribution, 0);
    expect(status(tree)).toBe('−1,000円以下になる確率 67%');
  });

  it('検証履歴が少ない場合だけ目安と説明する', () => {
    expect(text(render(defaultDistribution, 189000, true))).toContain(
      '記録が少ないため、確率は目安です。',
    );
    expect(text(render())).not.toContain('記録が少ないため');
  });
});
