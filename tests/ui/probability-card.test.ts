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
}));

import { ProbabilityCard } from '../../app/(app)/reports/probability-card';

type Props = {
  children?: ReactNode;
  role?: string;
  type?: string;
  className?: string;
  'aria-label'?: string;
  'aria-valuetext'?: string;
  min?: number;
  max?: number;
  value?: number;
  x?: number;
  width?: number;
  height?: number;
  fill?: string;
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
const status = (tree: ReactNode) =>
  text(nodes(tree).find((node) => node.props.role === 'status')?.props.children);
const header = (tree: ReactNode) =>
  text(nodes(tree).find((node) => node.props.className?.includes('text-[28px]'))?.props.children);
const coloredFraction = (tree: ReactNode) => {
  const bars = nodes(tree).filter((node) => node.type === 'rect');
  const area = (props: Props) => props.width! * props.height!;
  const total = bars.reduce((sum, bar) => sum + area(bar.props), 0);
  return (
    bars
      .filter((bar) => bar.props.fill === 'var(--accent)')
      .reduce((sum, bar) => sum + area(bar.props), 0) / total
  );
};

beforeEach(() => {
  state.host = createHookState();
});

describe('着地額の実際の分布と確率(ADR-122)', () => {
  it('歪んだ分布でも、見出し・色の面積・目標を選んだ結果が同じ確率になる', () => {
    const distribution: ForecastDistribution = {
      amounts: [100000, 100000, 110000, 110000, 110000, 120000, 120000, 500000],
      calibration: { pit: [0.1, 0.5, 0.8], pitWeight: 0.25 },
    };
    const target = 113879;
    let tree = render(distribution, target);
    const probability = probabilityAt(distribution, target);
    expect(header(tree)).toBe(formatProbability(probability));
    // 目標で分割した棒は幅が異なる。確率を高さにすると、この面積比は一致しない。
    expect(coloredFraction(tree)).toBeCloseTo(probability, 12);
    range(tree).onChange!({ target: { value: String(target) } });
    tree = render(distribution, target);
    expect(status(tree)).toBe(`113,879円以下になる確率 ${formatProbability(probability)}`);
    expect(range(tree)['aria-valuetext']).toBe(status(tree));
  });

  it('目標内が1%未満なら、それより低い金額の確率も1%未満になる', () => {
    const distribution: ForecastDistribution = {
      amounts: [155000, ...Array.from({ length: 999 }, (_, i) => 210000 + i * 100)],
      calibration: null,
    };
    let tree = render(distribution);
    expect(header(tree)).toBe('1%未満');
    range(tree).onChange!({ target: { value: '155000' } });
    tree = render(distribution);
    expect(status(tree)).toBe('155,000円以下になる確率 1%未満');
  });

  it('ポインターを画面幅から金額へ変換し、キーボード操作と同じ確率を出す', () => {
    let tree = render();
    const input = range(tree);
    const amount = 155000;
    const svgX = 3 + ((amount - input.min!) / (input.max! - input.min!)) * 320;
    const svg = nodes(tree).find((node) => node.type === 'svg')!;
    const capture = vi.fn();
    svg.props.onPointerDown!({
      pointerId: 1,
      clientX: 40 + svgX * 2,
      currentTarget: {
        setPointerCapture: capture,
        getBoundingClientRect: () => ({ left: 40, width: 652 }),
      },
    });
    tree = render();
    const pointerStatus = status(tree);
    expect(capture).toHaveBeenCalledWith(1);
    expect(pointerStatus).toBe('155,000円以下になる確率 29%');
    range(tree).onChange!({ target: { value: String(amount) } });
    expect(status(render())).toBe(pointerStatus);
  });

  it('幅0のグラフでは無効な金額を選ばず、範囲外の入力は端へ収める', () => {
    const tree = render();
    nodes(tree).find((node) => node.type === 'svg')!.props.onPointerDown!({
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

  it('全試行が目標と同額でも有限の幅を持ち、目標側に全ての面積を塗る', () => {
    const distribution: ForecastDistribution = { amounts: [0, 0, 0], calibration: null };
    const tree = render(distribution, 0);
    expect(header(tree)).toBe('99%以上');
    expect(range(tree).min).toBeLessThan(0);
    expect(range(tree).max).toBeGreaterThan(0);
    expect(coloredFraction(tree)).toBeCloseTo(1, 12);
    expect(renderToStaticMarkup(tree)).not.toMatch(/NaN|Infinity/);
  });

  it('返金によって負の着地がある場合も、元の分布を保つ', () => {
    const distribution: ForecastDistribution = {
      amounts: [-1500, -1000, 500],
      calibration: null,
    };
    let tree = render(distribution, 0);
    expect(range(tree).min).toBe(-1501);
    expect(coloredFraction(tree)).toBeCloseTo(2 / 3, 12);
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
