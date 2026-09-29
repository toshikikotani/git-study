import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * タップできる要素(button / Link / a / summary / 撮影ラベル)が、44pt 以上を明示しているかを
 * ソースから調べる。className に min-h-11 以上(または size-11 以上・h-11 以上)か、
 * style に minHeight >= 44 があれば合格。
 */
const TAPPABLE = new Set(['button', 'Link', 'a', 'summary']);
const OK_CLASS =
  /(?:^|\s)(?:min-h-(?:11|12|14|16|20|24)|size-(?:11|12|14|16)|h-(?:11|12|14|16|20|24)|min-h-\[(?:4[4-9]|[5-9]\d)px\])(?:\s|$)/;

export type TapTargetIssue = { file: string; line: number; tag: string; snippet: string };

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function attrText(node: ts.JsxOpeningLikeElement, name: string, sf: ts.SourceFile): string | null {
  for (const a of node.attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText(sf) === name) {
      return a.initializer ? a.initializer.getText(sf) : '';
    }
  }
  return null;
}

export function findTapTargetIssues(files: readonly string[]): TapTargetIssue[] {
  const issues: TapTargetIssue[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sf);
        const isTappable =
          TAPPABLE.has(tag) ||
          (tag === 'label' && /role="menuitem"/.test(node.getText(sf))) ||
          // 撮影のラベル(ファイル入力を包む)
          (tag === 'label' && /cursor-pointer/.test(node.getText(sf)));
        if (isTappable) {
          const cls = attrText(node, 'className', sf) ?? '';
          const style = attrText(node, 'style', sf) ?? '';
          const ok =
            OK_CLASS.test(` ${cls.replace(/\$\{[^}]*\}/g, ' ').replace(/["'{}`]/g, ' ')} `) ||
            /minHeight:\s*(4[4-9]|[5-9]\d)/.test(style) ||
            // 明示的な例外(ダミーのリンクなど、44pt を親が担保しているもの)
            /data-tap-ok/.test(node.getText(sf));
          if (!ok) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            issues.push({
              file,
              line: line + 1,
              tag,
              snippet: node.getText(sf).slice(0, 120).replace(/\s+/g, ' '),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return issues;
}
