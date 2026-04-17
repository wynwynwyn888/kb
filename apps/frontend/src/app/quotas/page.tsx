// Quota page placeholder
// View quota usage and transaction history

export default function QuotaPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Quota Management</h1>
      <div>
        <h2>Current Period</h2>
        <p>Period: April 1 - April 30, 2026</p>
        <div>
          <p>Total Quota: <strong>10,000</strong></p>
          <p>Used: <strong>2,450</strong></p>
          <p>Remaining: <strong>7,550</strong></p>
        </div>
      </div>
      <div>
        <h2>Transaction History</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {/* TODO: Populate from API */}
            <tr>
              <td>2026-04-15</td>
              <td>-15</td>
              <td>Outbound message</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}