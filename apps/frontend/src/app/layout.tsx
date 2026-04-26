// Root layout with Auth provider
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '../contexts/AuthContext';
import { UnauthorizedSessionHandler } from '../components/app/UnauthorizedSessionHandler';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AISBP',
  description: 'Agency and subaccount AI conversation layer for GoHighLevel',
  icons: {
    icon: [{ url: '/favicon.jpg', type: 'image/jpeg' }],
    shortcut: '/favicon.jpg',
    apple: '/favicon.jpg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.className}>
      <body style={{ margin: 0 }}>
        <AuthProvider>
          <UnauthorizedSessionHandler />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
