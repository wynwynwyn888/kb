import { AgencyWorkspaceGate } from '@/components/app/AgencyWorkspaceGate';

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return <AgencyWorkspaceGate>{children}</AgencyWorkspaceGate>;
}
