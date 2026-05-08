import AppRouteChrome from '@/components/app/AppRouteChrome';

export default function AppRouteLayout({ children }: { children: React.ReactNode }) {
  return <AppRouteChrome>{children}</AppRouteChrome>;
}
