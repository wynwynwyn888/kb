// Settings page placeholder
// Configure GHL connection, system policies, and general settings

export default function SettingsPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Settings</h1>
      <section>
        <h2>GHL Connection</h2>
        <p>Status: <span style={{ color: 'green' }}>Connected</span></p>
        <button>Disconnect</button>
        <p>TODO: OAuth connect flow</p>
      </section>
      <section>
        <h2>System Policies</h2>
        <p>TODO: Edit agency system policies</p>
      </section>
      <section>
        <h2>Output Formatting</h2>
        <select>
          <option value="bubble">Bubble Format</option>
          <option value="plain">Plain Text</option>
          <option value="markdown">Markdown</option>
        </select>
      </section>
      <section>
        <h2>Team Members</h2>
        <p>TODO: Manage agency and subaccount access</p>
      </section>
    </main>
  );
}