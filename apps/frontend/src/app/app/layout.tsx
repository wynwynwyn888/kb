import { AppShell } from '@/components/app/AppShell';

export default function AppRouteLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
