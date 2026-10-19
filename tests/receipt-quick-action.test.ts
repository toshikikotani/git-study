import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseReceiptQuickAction, readReceiptQuickAction } from '@/lib/receipt-quick-action';
import { createLongPress } from '@/lib/long-press';

afterEach(() => vi.unstubAllGlobals());
describe('レシートの長押し設定', () => {
  it('未設定・不正値・ストレージ拒否でもカメラを起動する', () => {
    expect(parseReceiptQuickAction(null)).toBe('camera');
    expect(parseReceiptQuickAction('invalid')).toBe('camera');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(readReceiptQuickAction()).toBe('camera');
  });
  it('保存済みの手入力を認識し、長押し後のクリックを1度だけ抑止する', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'manual' });
    const actions: string[] = [];
    let fire: () => void = () => {};
    const gesture = createLongPress({
      onLongPress: () => actions.push(readReceiptQuickAction()),
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {},
    });
    gesture.start(0, 0);
    fire();
    gesture.end();
    expect(actions).toEqual(['manual']);
    expect(gesture.consumeClick()).toBe(true);
    expect(gesture.consumeClick()).toBe(false);
  });
});
