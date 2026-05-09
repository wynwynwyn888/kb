// Root layout with Auth provider
import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import { AuthProvider } from '../contexts/AuthContext';
import { UnauthorizedSessionHandler } from '../components/app/UnauthorizedSessionHandler';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

const themeBoot = `(function(){try{var k='aisbp-theme';var v=localStorage.getItem(k);var sys=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=v==='light'||v==='dark'?v:(sys?'dark':'light');document.documentElement.classList.toggle('dark',r==='dark');}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'AISalesBot Pro',
  description: 'Agency and workspace AI conversation layer for CRM',
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
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body style={{ margin: 0 }}>
        <Script id="aisbp-theme-boot" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <AuthProvider>
          <UnauthorizedSessionHandler />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
