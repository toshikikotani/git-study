'use client';

import { BottomSheet } from '@/components/ui/bottom-sheet';

/**
 * iPhone のカメラから戻ったところに出す小さなシート(v5 変更1、ADR-133)。読み取りは裏で進むので、
 * 待たずに「もう1枚撮る」で続けて撮れる(画面を移らない)。「確かめる」で保存前のレシートを開く。
 *
 * mode = 'start' は、押す操作なしではカメラを開けないとき(ショートカットから来たときなど)に、
 * 大きな「撮る」を1つだけ出す。
 */
export function CaptureSheet({
  mode,
  count,
  reading,
  onClose,
  onShoot,
  onCheck,
}: {
  mode: 'start' | 'after' | null;
  /** この回に撮った枚数。 */
  count: number;
  /** 読み取り中の枚数。 */
  reading: number;
  onClose: () => void;
  /** 押したときの処理の中で、そのままカメラを開く。 */
  onShoot: () => void;
  onCheck: () => void;
}) {
  return (
    <BottomSheet open={mode !== null} onClose={onClose} role="dialog" label="レシートを撮る">
      <div className="flex flex-col gap-4 px-3 pt-2 pb-4" style={{ color: 'var(--ink)' }}>
        {mode === 'after' ? (
          <>
            <div className="flex flex-col gap-1 px-1">
              <p className="text-[17px] font-semibold">{count}枚 撮りました</p>
              <p role="status" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {reading > 0
                  ? `読み取り中 ${reading}枚 · 待たずに続けて撮れます`
                  : '読み取りました。確かめて保存してください'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onShoot}
                className="min-h-14 rounded-2xl text-[17px] font-semibold"
                style={{ background: 'var(--field)', color: 'var(--ink)' }}
              >
                もう1枚撮る
              </button>
              <button
                type="button"
                onClick={onCheck}
                className="btn-primary min-h-14 rounded-2xl text-[17px] font-semibold"
              >
                確かめる
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={onShoot}
            className="btn-primary min-h-16 rounded-2xl text-[20px] font-semibold"
          >
            撮る
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
