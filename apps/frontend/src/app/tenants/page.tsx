// Tenant switcher placeholder
// Allows agency users to switch between tenants

export default function TenantSwitcherPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Switch Tenant</h1>
      <div>
        <h2>Your Tenants</h2>
        <ul>
          {/* TODO: List tenants from API */}
          <li>Tenant 1</li>
          <li>Tenant 2</li>
        </ul>
      </div>
      <p>TODO: Implement tenant switching with context</p>
    </main>
  );
}