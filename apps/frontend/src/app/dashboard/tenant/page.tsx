// Tenant dashboard shell
// Tenant-scoped view with switcher, shows tenant-specific settings and logs

export default function TenantDashboardPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Tenant Dashboard</h1>
      <div>
        <h2>Active Conversations</h2>
        <p>TODO: Show tenant conversation list</p>
      </div>
      <div>
        <h2>Quick Settings</h2>
        <p>TODO: Tenant prompt config, handover settings</p>
      </div>
      <div>
        <h2>Recent Activity</h2>
        <p>TODO: Tenant audit log summary</p>
      </div>
    </main>
  );
}