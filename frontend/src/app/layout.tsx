import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'Email Automation — AI inbox operations',
  description:
    'Connect a Gmail, Outlook or IMAP mailbox, let AI draft the replies, and approve anything it is not sure about.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      {/*
        The font stack lives in Tailwind rather than next/font/google on
        purpose: next/font downloads the family at build time, so a blocked or
        offline network fails the whole build. The stack below resolves to
        Inter when it is installed and to the platform UI font otherwise —
        Segoe UI on Windows, SF on macOS — which is what Inter was imitating.
      */}
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
