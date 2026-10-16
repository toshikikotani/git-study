/**
 * 似た名前のカテゴリ(デザイン仕様書の「カテゴリの設定」の「「医療・健康」と似ています まとめる」、ADR-090)。
 * 区切り(・ 空白 /)を除いた名前が、先頭2文字以上で同じか、一方がもう一方を含むとき「似ている」とする。
 */
function normalize(name: string): string {
  return name.replace(/[・\s/／]/g, '');
}

function similar(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (x.length < 2 || y.length < 2 || x === y) return x === y && a !== b;
  if (x.includes(y) || y.includes(x)) return true;
  return x.slice(0, 2) === y.slice(0, 2);
}

/** 各カテゴリについて、似ているほかのカテゴリ(並び順で最初のもの)。似たものが無ければ入らない。 */
export function similarCategories(
  categories: readonly { id: string; name: string }[],
): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>();
  for (const c of categories) {
    const match = categories.find((o) => o.id !== c.id && similar(c.name, o.name));
    if (match) out.set(c.id, { id: match.id, name: match.name });
  }
  return out;
}
