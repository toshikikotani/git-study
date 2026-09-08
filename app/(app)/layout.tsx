import Link from 'next/link';

const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/debts', label: '負債' },
  { href: '/transactions', label: '明細' },
  { href: '/payday', label: '給料日' },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <main className="flex-1 px-4 pb-24 pt-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <ul className="mx-auto flex w-full max-w-2xl">
          {NAV.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className="block py-3 text-center text-sm text-neutral-600 dark:text-neutral-300"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
