'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { actualSpentYen, buildCategoryLines } from '@/features/category/model';
import type { CategoryDetailData } from '@/features/category/loader';
import { isEdgeBackSwipe } from '@/lib/category-nav';
import { CategoryHeader } from './category-header';

/**
 * カテゴリ詳細の画面(クライアント側)。読み込んだ明細をここで持ち、編集・移動は
 * この状態を即座に書き換える(楽観的更新)。合計・グラフ・気づきは、この状態から
 * 家計簿と同じ集計関数で計算し直す。
 */
export function CategoryScreen({ data }: { data: CategoryDetailData }) {
  return <CategoryScreenInner key={`${data.genreKey}:${data.monthKey}`} data={data} />;
}

function CategoryScreenInner({ data }: { data: CategoryDetailData }) {
  const router = useRouter();
  const [transactions] = useState(data.transactions);

  const lines = useMemo(
    () => buildCategoryLines(transactions, data.genreKey, data.range, data.today),
    [transactions, data.genreKey, data.range, data.today],
  );
  const totalYen = actualSpentYen(lines);

  // 画面の左端からのスワイプで戻る。戻ると、家計簿の元のスクロール位置に戻る。
  const edge = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      edge.current = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      const s = edge.current;
      edge.current = null;
      if (s && isEdgeBackSwipe(s.x, e.clientX - s.x, e.clientY - s.y)) router.back();
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [router]);

  return (
    <div className="space-y-4">
      <CategoryHeader
        genreKey={data.genreKey}
        genreName={data.genreName}
        monthStart={data.monthStart}
        isCurrentMonth={data.isCurrentMonth}
        totalYen={totalYen}
        onBack={() => router.back()}
      />
    </div>
  );
}
