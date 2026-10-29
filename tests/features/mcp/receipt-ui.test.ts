/**
 * レシートの「これでいいですか」の画面(ADR-146)。MCP Apps の部品を HTML の中に入れ、外から読み込まない。
 * AI が読んだ名前は HTML として解釈しない。「はい」で save_receipt を呼ぶ。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { inlineModule, receiptConfirmHtml, SAVE_RECEIPT_TOOL } from '@/features/mcp/receipt-ui';

const scriptOf = (html: string) =>
  html.slice(
    html.indexOf('<script type="module">') + '<script type="module">'.length,
    html.lastIndexOf('</script>'),
  );

describe('部品を中に入れる', () => {
  it('最後の export を外し、使うものだけを __ext に入れる', () => {
    const code = inlineModule('var a=1;function b(){};export{a as App,b as other,c};', [
      'App',
      'c',
    ]);
    expect(code).toBe('var a=1;function b(){};\nconst __ext={App:a,c:c};');
    expect(() => inlineModule('var a=1;', ['App'])).toThrow(/export/);
    expect(() => inlineModule('export{a as App};', ['Nope'])).toThrow(/Nope/);
  });
});

describe('画面の HTML', () => {
  const html = receiptConfirmHtml();
  const script = scriptOf(html);
  /** 部品のあとの、この画面の動き。 */
  const view = script.slice(script.indexOf('const __ext={'));

  it('部品は中に入っていて、外のサイトから読み込まない', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)=/);
    expect(view).not.toMatch(/https?:\/\//);
    expect(script).toContain('const __ext={App:');
    expect(script).not.toMatch(/^export\s*\{/m);
  });

  it('「はい」は save_receipt を呼び、名前は textContent でだけ入れる', () => {
    expect(view).toContain(`name: '${SAVE_RECEIPT_TOOL}'`);
    expect(html).toContain('はい、登録する');
    expect(html).toContain('やめる');
    expect(view).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('ブラウザの ES モジュールとして読める', () => {
    const dir = mkdtempSync(join(tmpdir(), 'receipt-ui-'));
    try {
      const file = join(dir, 'view.mjs');
      writeFileSync(file, script);
      const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      expect(checked.stderr).toBe('');
      expect(checked.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
