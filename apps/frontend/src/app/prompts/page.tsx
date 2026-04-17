// Prompt editor placeholder
// Edit system prompts and prompt variables for tenant

export default function PromptEditorPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Prompt Editor</h1>
      <div>
        <h2>System Prompt</h2>
        <textarea
          rows={10}
          style={{ width: '100%' }}
          placeholder="Enter system prompt..."
        />
      </div>
      <div>
        <h2>Prompt Variables</h2>
        <p>TODO: Key-value editor for prompt variables</p>
      </div>
      <div>
        <h2>Model Settings</h2>
        <p>TODO: Temperature, max tokens, model override</p>
      </div>
      <button>Save Changes</button>
    </main>
  );
}