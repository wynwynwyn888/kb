// Next.js app layout - root layout
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI SaaS Business Platform',
  description: 'Multi-tenant AI conversation middleware for GoHighLevel',
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