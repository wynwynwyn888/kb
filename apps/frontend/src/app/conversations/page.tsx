// Conversation logs placeholder
// View and search conversation history

export default function ConversationLogsPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Conversation Logs</h1>
      <div>
        <input type="text" placeholder="Search conversations..." />
        <button>Search</button>
      </div>
      <div>
        <h2>Recent Conversations</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Contact</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Last Message</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* TODO: Populate from API */}
            <tr>
              <td>Contact Name</td>
              <td>WhatsApp</td>
              <td>Active</td>
              <td>2 mins ago</td>
              <td><button>View</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}