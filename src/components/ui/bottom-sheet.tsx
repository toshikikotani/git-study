'use client';

import { Drawer } from 'vaul';

/**
 * 下から出るシート。開閉の追従と下引きは vaul に任せる。
 * 閉じているあいだは vaul(Radix)が中身を描かない。
 *
 * 縦長のシート(tall:記録する・カテゴリなど、入力欄のあるもの)は、上のつまみでだけ引っぱれるようにし、
 * vaul の入力欄まわりの手当て(キーボードに合わせた高さの変更・iPhone で入力欄を押したときの独自のフォーカス)
 * を止める。シートのどこを押しても「引っぱり」が始まり、入力欄でカーソルが思った所に置けない・
 * キーボードが出るとシートが動く、という入力しづらさの元になっていたため(ADR-097)。
 */
export function BottomSheet({
  open,
  onClose,
  role,
  label = 'シート',
  tall = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  role?: string;
  /** 読み上げ用の名前(画面には出さない)。 */
  label?: string;
  /**
   * 画面の高さいっぱいの灰色のシート(デザイン仕様書の「記録する」「カテゴリの目標額」、ADR-090)。
   * 角は上だけ丸く、下端まで伸ばす。
   */
  tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      dismissible
      handleOnly={tall}
      repositionInputs={!tall}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-[rgba(10,16,32,0.45)]" />
        <Drawer.Content
          role={role}
          aria-describedby={undefined}
          // vaul はシート全体を touch-action: none にする。つまみでだけ引っぱるシートでは、中の操作
          // (入力欄のカーソル・スクロール)をブラウザに任せる。
          style={tall ? { touchAction: 'manipulation' } : undefined}
          className={
            tall
              ? 'fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl outline-none'
              : 'fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none'
          }
        >
          <div
            className={
              tall
                ? 'max-h-[92dvh] overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))]'
                : 'max-h-[78dvh] overflow-y-auto overscroll-contain p-2'
            }
            style={
              tall
                ? {
                    borderRadius: '22px 22px 0 0',
                    background: 'var(--plane)',
                    boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.12)',
                  }
                : {
                    borderRadius: 'var(--radius-card)',
                    background: 'var(--surface)',
                    border: '1px solid var(--glass-border)',
                    boxShadow: 'var(--glass-shadow-float)',
                  }
            }
          >
            <Drawer.Title className="sr-only">{label}</Drawer.Title>
            <Drawer.Handle className="mx-auto mt-2 mb-1 block h-1.5 w-10 rounded-full bg-[var(--hairline)]" />
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
