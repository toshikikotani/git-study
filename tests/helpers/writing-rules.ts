import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * docs/WRITING.md の「1. 責めない」を機械的に検査する。JSX が画面に出す文字列
 * (JSXText・文字列/テンプレートリテラル)だけを対象にし、コメントは対象外
 * (TypeScript の AST はコメントをトリビアとして扱い、文字列/JSXText ノードには
 * 現れないため、コメント中の用語解説は自然に除外される)。
 *
 * 「失敗」は対象外にした:「読み込みに失敗しました」のような、本人の支出判断
 * ではなくシステム操作(通信・保存)の失敗を指す用法がアプリ全体に広く正当に
 * 存在し、機械的な文字列一致では区別できないため(docs/WRITING.md 4参照)。
 */
const BANNED_WORDS = ['浪費', '無駄遣い', '無駄', '使いすぎ', '怠け'];

export type WritingRuleIssue = { file: string; line: number; word: string; snippet: string };

export function findWritingRuleIssues(files: readonly string[]): WritingRuleIssue[] {
  const issues: WritingRuleIssue[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      const isTextBearing =
        ts.isJsxText(node) ||
        ts.isStringLiteralLike(node) ||
        ts.isTemplateExpression(node) ||
        ts.isNoSubstitutionTemplateLiteral(node);
      if (isTextBearing) {
        const content = node.getText(sf);
        for (const word of BANNED_WORDS) {
          if (content.includes(word)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            issues.push({
              file,
              line: line + 1,
              word,
              snippet: content.trim().slice(0, 80).replace(/\s+/g, ' '),
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
