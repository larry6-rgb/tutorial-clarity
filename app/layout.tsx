import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tutorial Clarity',
  description: 'Enhanced YouTube video learning experience',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}