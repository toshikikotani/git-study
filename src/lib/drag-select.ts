/**
 * なぞって複数選択(写真アプリの複数選択と同じ操作)。
 * 最初に触れた行が「選ばれていなければ、なぞった行をすべて選ぶ」「選ばれていれば、なぞった行の選択を外す」
 * のどちらの動きかを決める。なぞった順に行を渡す(visit)と、範囲の途中を飛ばしても、
 * 開始の行から今の行までの間の行がすべて対象になる。
 */
export class DragSelect {
  private mode: 'add' | 'remove' | null = null;
  private startIndex = -1;
  private base: ReadonlySet<string> = new Set();
  private order: readonly string[] = [];

  /** order は画面に並んでいる行の id(上から順)。 */
  begin(order: readonly string[], selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const i = order.indexOf(id);
    if (i < 0) return selected;
    this.order = order;
    this.startIndex = i;
    this.base = new Set(selected);
    this.mode = selected.has(id) ? 'remove' : 'add';
    return this.apply(i);
  }

  get active(): boolean {
    return this.mode !== null;
  }

  /** いま指が乗っている行。開始の行との間の行も含めて、選択(または解除)する。 */
  visit(id: string): ReadonlySet<string> | null {
    if (this.mode === null) return null;
    const i = this.order.indexOf(id);
    if (i < 0) return null;
    return this.apply(i);
  }

  end(): void {
    this.mode = null;
    this.startIndex = -1;
  }

  private apply(index: number): ReadonlySet<string> {
    const [from, to] =
      index < this.startIndex ? [index, this.startIndex] : [this.startIndex, index];
    const next = new Set(this.base);
    for (let k = from; k <= to; k++) {
      const id = this.order[k]!;
      if (this.mode === 'add') next.add(id);
      else next.delete(id);
    }
    return next;
  }
}
