import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Novi', description: 'Entreprises tech autour de chez moi' };

const NAV = [
  { href: '/', label: 'Explorer' },
  { href: '/employeurs-inconnus', label: 'Employeurs inconnus' },
  { href: '/profil', label: 'Profil' },
  { href: '/pipeline', label: 'Pipeline' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-background text-foreground">
        <header className="border-b">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              Novi
            </Link>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
