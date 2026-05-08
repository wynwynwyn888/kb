// Basic navigation component placeholder
// TODO: Implement proper navigation with auth state

export function NavBar() {
  return (
    <nav style={{ padding: '1rem', borderBottom: '1px solid #ccc', display: 'flex', gap: '1rem' }}>
      <a href="/dashboard/agency">Agency</a>
      <a href="/dashboard/tenant">Subaccount</a>
      <a href="/tenants">Subaccounts</a>
      <a href="/prompts">Prompts</a>
      <a href="/app">Workspace</a>
      <a href="/conversations">Conversations</a>
      <a href="/quotas">Credits</a>
      <a href="/tester">Tester</a>
    </nav>
  );
}