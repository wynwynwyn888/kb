// Bot tester placeholder
// Test AI responses with sample conversations

export default function BotTesterPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Bot Tester</h1>
      <div>
        <h2>Test Conversation</h2>
        <div style={{ border: '1px solid #ccc', padding: '1rem', minHeight: '200px' }}>
          {/* TODO: Chat-like interface */}
          <p>Conversation will appear here...</p>
        </div>
      </div>
      <div>
        <input
          type="text"
          placeholder="Type a test message..."
          style={{ width: '80%' }}
        />
        <button>Send</button>
      </div>
      <div>
        <h3>Debug Info</h3>
        <p>TODO: Show KB retrieved, prompt used, model response</p>
      </div>
    </main>
  );
}