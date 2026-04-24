// Root layout with Auth provider
import type { Metadata } from 'next';
import { AuthProvider } from '../contexts/AuthContext';
import { UnauthorizedSessionHandler } from '../components/app/UnauthorizedSessionHandler';

export const metadata: Metadata = {
  title: 'AI SaaS Business Platform',
  description: 'Agency and subaccount AI conversation layer for GoHighLevel',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <UnauthorizedSessionHandler />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}