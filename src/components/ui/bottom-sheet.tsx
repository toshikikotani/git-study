'use client';

import { Drawer } from 'vaul';

/**
 * 下から出るシート。開閉の追従と下引きは vaul に任せる。
 * 閉じているあいだは vaul(Radix)が中身を描かない。
 *
 * どのシートも、上のつまみでだけ引っぱれるようにし、vaul の入力欄まわりの手当て(キーボードに合わせて
 * シートを持ち上げる・iPhone で入力欄を押したときの独自のフォーカス)を止める。シートのどこを押しても
 * 「引っぱり」が始まり、入力欄の上で指が少し動くだけでシートが動いていた(ADR-097)。キーボードが出ると、
 * vaul と iPhone の両方がシートを持ち上げて二重に上がり、入力中の欄が画面の外に出ていた(明細の編集、
 * ADR-099)。キーボードに合わせて入力欄を見せるのは iPhone に任せる。外を押す・つまみを引くと閉じる。
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
   * 灰色の背景で下端まで伸ばす。高さは全シート共通(ADR-110追補)。
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
      handleOnly
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-[rgba(10,16,32,0.45)]" />
        <Drawer.Content
          role={role}
          aria-describedby={undefined}
          // vaul はシート全体を touch-action: none にする。つまみでだけ引っぱるので、中の操作
          // (入力欄のカーソル・スクロール)はブラウザに任せる。
          style={{ touchAction: 'manipulation' }}
          className={
            tall
              ? 'fixed inset-x-0 bottom-0 z-50 mx-auto h-[92dvh] w-full max-w-2xl outline-none'
              : 'fixed inset-x-0 bottom-0 z-50 mx-auto h-[92dvh] w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none'
          }
        >
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden"
            style={
              {
                '--sheet-background': tall ? 'var(--plane)' : 'var(--surface)',
                borderRadius: tall ? '22px 22px 0 0' : 'var(--radius-card)',
                background: 'var(--sheet-background)',
                border: tall ? undefined : '1px solid var(--glass-border)',
                boxShadow: tall ? '0 -4px 24px rgba(0, 0, 0, 0.12)' : 'var(--glass-shadow-float)',
              } as React.CSSProperties
            }
          >
            <Drawer.Title className="sr-only">{label}</Drawer.Title>
            <Drawer.Handle className="mx-auto mt-2 mb-1 block h-1.5 w-10 shrink-0 rounded-full bg-[var(--hairline)]" />
            <div
              data-sheet-scroll
              className={
                tall
                  ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))]'
                  : 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2'
              }
            >
              {children}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** スクロール中も見出しと操作を上端に残す。背景を塗り、本文が重ならないようにする。 */
export function BottomSheetHeader({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-sheet-header
      className={`sticky top-0 z-10 shrink-0 py-1 ${className}`}
      style={{ background: 'var(--sheet-background, var(--plane))' }}
    >
      {children}
    </div>
  );
}
