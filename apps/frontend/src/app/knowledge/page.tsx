// Knowledge base placeholder
// Upload, manage, and search knowledge documents

export default function KnowledgeBasePage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Knowledge Base</h1>
      <div>
        <h2>Upload Document</h2>
        <input type="file" />
        <button>Upload</button>
      </div>
      <div>
        <h2>Documents</h2>
        <ul>
          {/* TODO: List documents */}
          <li>Document 1 - Status: ready</li>
          <li>Document 2 - Status: processing</li>
        </ul>
      </div>
      <div>
        <h2>Search</h2>
        <input type="text" placeholder="Search knowledge..." />
        <button>Search</button>
      </div>
    </main>
  );
}