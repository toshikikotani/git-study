import { describe, expect, it } from 'vitest';

import { DragSelect } from '../../src/lib/drag-select';

const order = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('P7 なぞって複数選択(写真アプリと同じ操作)', () => {
  it('選ばれていない行から始めると、なぞった範囲を選ぶ(飛ばした行も含めて、開始の行から今の行まで)', () => {
    const d = new DragSelect();
    expect([...d.begin(order, new Set(), 'b')]).toEqual(['b']);
    expect([...d.visit('c')!]).toEqual(['b', 'c']);
    expect([...d.visit('e')!]).toEqual(['b', 'c', 'd', 'e']); // 指が速くて c,d を飛ばしても
    d.end();
    expect(d.visit('f')).toBeNull();
  });

  it('戻ると選択が縮む(指が戻った行までになる)。上向きになぞっても同じ', () => {
    const d = new DragSelect();
    d.begin(order, new Set(), 'd');
    d.visit('f');
    expect([...d.visit('e')!]).toEqual(['d', 'e']);
    expect([...d.visit('b')!].sort()).toEqual(['b', 'c', 'd']);
  });

  it('すでに選ばれている行から始めると、なぞった範囲の選択を外す。ほかの選択は残る', () => {
    const d = new DragSelect();
    const start = new Set(['a', 'b', 'c', 'e']);
    expect([...d.begin(order, start, 'b')].sort()).toEqual(['a', 'c', 'e']);
    expect([...d.visit('c')!].sort()).toEqual(['a', 'e']);
    expect([...d.visit('a')!].sort()).toEqual(['c', 'e']); // b→a の範囲(a,b)だけ外れる
  });

  it('見つからない行は無視する', () => {
    const d = new DragSelect();
    expect([...d.begin(order, new Set(['a']), 'zzz')]).toEqual(['a']);
    expect(d.active).toBe(false);
    d.begin(order, new Set(), 'a');
    expect(d.visit('zzz')).toBeNull();
  });
});
