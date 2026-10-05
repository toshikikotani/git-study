'use client';

import { Drawer } from 'vaul';

/**
 * 下から出るシート。開閉の追従と下引きは vaul に任せる。
 * 呼び出し側の props は変えない。
 */
export function BottomSheet({
  open,
  onClose,
  role,
  children,
}: {
  open: boolean;
  onClose: () => void;
  role?: string;
  children: React.ReactNode;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      dismissible
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-[rgba(10,16,32,0.45)]" />
        <Drawer.Content
          role={role}
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none"
        >
          <div
            className="max-h-[78dvh] overflow-y-auto overscroll-contain p-2"
            style={{
              borderRadius: 'var(--radius-card)',
              background: 'var(--surface)',
              border: '1px solid var(--glass-border)',
              boxShadow: 'var(--glass-shadow-float)',
            }}
          >
            <Drawer.Handle className="mx-auto mt-2 mb-1 block h-1.5 w-10 rounded-full bg-[var(--hairline)]" />
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export const SHEET_EXIT_MS = 500;
