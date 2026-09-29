import { describe, expect, it } from 'vitest';

import { isIOSWebKit } from '../../src/components/ui/shared-element';

describe('iOS では共有要素(ViewTransition)を使わない', () => {
  it('iPhone / iPad / iPadOS(Mac を名乗る)を判定し、Android・PC は対象外', () => {
    expect(
      isIOSWebKit('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(true);
    expect(isIOSWebKit('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(true);
    expect(isIOSWebKit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIOSWebKit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIOSWebKit('Mozilla/5.0 (Linux; Android 14) Chrome/126')).toBe(false);
  });
});
