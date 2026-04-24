'use client';

import type { CSSProperties } from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  createKbFaq,
  createKbRichText,
  deleteKbDocument,
  isApiHttpError,
  listKbDocuments,
  searchKb,
  uploadKbFile,
  type KbDocumentRow,
} from '@/lib/api';
import {
  ErrorBanner,
  EmptyState,
  LoadingBlock,
  PageHeader,
  SectionCard,
  SuccessBanner,
} from '@/components/app/mvp-ui';
import { BotTestPanel } from '@/components/app/bot-test/BotTestPanel';

const tabButton = (active: boolean): CSSProperties => ({
  padding: '0.45rem 0.9rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  border: '1px solid',
  borderColor: active ? '#0f172a' : '#e2e8f0',
  background: active ? '#0f172a' : '#fff',
  color: active ? '#fff' : '#334155',
  borderRadius: '6px',
  cursor: 'pointer',
});

const topAction: CSSProperties = {
  padding: '0.4rem 0.75rem',
  fontSize: '0.8rem',
  borderRadius: '6px',
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#0f172a',
  cursor: 'pointer',
  fontWeight: 600,
};

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.82rem',
};

const th: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.45rem',
  borderBottom: '1px solid #e2e8f0',
  color: '#64748b',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const td: CSSProperties = {
  padding: '0.5rem 0.45rem',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top' as const,
};

/** Legacy rows may omit `documentKind` — use source/title heuristics only as fallback. */
function classifiesAsFaq(d: KbDocumentRow): boolean {
  return d.source.toLowerCase() === 'faq' || d.title.toLowerCase().startsWith('faq:');
}

function classifiesAsFile(d: KbDocumentRow): boolean {
  const s = d.source.toLowerCase();
  if (classifiesAsFaq(d)) return false;
  if (s === 'rich_text' || s === 'rich' || s === 'manual' || s.includes('richtext')) return false;
  return (
    s.includes('pdf') ||
    s.includes('doc') ||
    s.includes('file') ||
    s.includes('txt') ||
    s.includes('upload') ||
    /\.(pdf|docx?|txt)(\b|$)/i.test(d.title)
  );
}

type KbRowBucket = 'faq' | 'rich' | 'file' | 'other';

function rowBucket(d: KbDocumentRow): KbRowBucket {
  const k = (d.documentKind || '').toLowerCase();
  if (k === 'faq') return 'faq';
  if (k === 'rich_text') return 'rich';
  if (k === 'file') return 'file';
  if (k === 'manual' || k === '') {
    if (classifiesAsFaq(d)) return 'faq';
    if (classifiesAsFile(d)) return 'file';
    return 'other';
  }
  return 'other';
}

type Tab = 'faq' | 'rich' | 'files';

function friendlifyKbMessage(msg: string): string {
  const l = msg.toLowerCase();
  if (l.includes('schema cache') || (l.includes('pgrst') && l.includes('schema'))) {
    return 'The knowledge service is updating. Please wait a minute and try again.';
  }
  if (l.includes('document_kind') && l.includes('column')) {
    return 'Knowledge base could not be saved. Contact support if this continues.';
  }
  return msg;
}

export default function SubaccountKnowledgePage() {
  const params = useParams();
  const subId = params['tenantId'] as string;
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('faq');
  const [docs, setDocs] = useState<KbDocumentRow[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const [writeErr, setWriteErr] = useState('');
  const [saveOk, setSaveOk] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [faqQ, setFaqQ] = useState('');
  const [faqA, setFaqA] = useState('');
  const [richTitle, setRichTitle] = useState('');
  const [richBody, setRichBody] = useState('');

  const [qSearch, setQSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [searchChunks, setSearchChunks] = useState<unknown[] | null>(null);

  const load = useCallback(async () => {
    if (!token || !subId) return;
    setLoading(true);
    setLoadErr('');
    try {
      const d = await listKbDocuments(token, subId, { allStatuses: true });
      setDocs(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      setLoadErr(friendlifyKbMessage(msg));
    } finally {
      setLoading(false);
    }
  }, [token, subId, reload]);

  useEffect(() => {
    void load();
  }, [load]);

  const { faqRows, richRows, fileRows, otherRows } = useMemo(() => {
    const faq: KbDocumentRow[] = [];
    const file: KbDocumentRow[] = [];
    const rich: KbDocumentRow[] = [];
    const other: KbDocumentRow[] = [];
    for (const d of docs) {
      const b = rowBucket(d);
      if (b === 'faq') faq.push(d);
      else if (b === 'file') file.push(d);
      else if (b === 'rich') rich.push(d);
      else {
        other.push(d);
        rich.push(d);
      }
    }
    return { faqRows: faq, richRows: rich, fileRows: file, otherRows: other };
  }, [docs]);

  const bump = () => setReload(x => x + 1);

  const onFaqSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || !subId) return;
    const form = e.currentTarget;
    const qEl = form.elements.namedItem('kb-faq-question') as HTMLInputElement | null;
    const aEl = form.elements.namedItem('kb-faq-answer') as HTMLTextAreaElement | null;
    const q = (qEl?.value ?? faqQ).trim();
    const a = (aEl?.value ?? faqA).trim();
    if (!q || !a) {
      setWriteErr('Enter both a question and an answer.');
      setSaveOk('');
      return;
    }
    setWriteErr('');
    setSaveOk('');
    setSaving(true);
    try {
      await createKbFaq(token, { tenantId: subId, question: q, answer: a });
      setFaqQ('');
      setFaqA('');
      setSaveOk('FAQ saved.');
      await load();
    } catch (er) {
      const raw = isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Save failed';
      setWriteErr(friendlifyKbMessage(raw));
    } finally {
      setSaving(false);
    }
  };

  const onRichSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || !subId) return;
    const form = e.currentTarget;
    const tEl = form.elements.namedItem('kb-rich-title') as HTMLInputElement | null;
    const bEl = form.elements.namedItem('kb-rich-body') as HTMLTextAreaElement | null;
    const title = (tEl?.value ?? richTitle).trim();
    const body = (bEl?.value ?? richBody).trim();
    if (!title || !body) {
      setWriteErr('Enter both a title and the text content.');
      setSaveOk('');
      return;
    }
    setWriteErr('');
    setSaveOk('');
    setSaving(true);
    try {
      await createKbRichText(token, { tenantId: subId, title, content: body });
      setRichTitle('');
      setRichBody('');
      setSaveOk('Rich text saved.');
      await load();
    } catch (er) {
      const raw = isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Save failed';
      setWriteErr(friendlifyKbMessage(raw));
    } finally {
      setSaving(false);
    }
  };

  const onFileChange = async (e: FormEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!token || !subId || !file) return;
    setWriteErr('');
    setSaveOk('');
    setSaving(true);
    try {
      await uploadKbFile(token, subId, file);
      setSaveOk('File uploaded.');
      await load();
    } catch (er) {
      const raw = isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Upload failed';
      setWriteErr(friendlifyKbMessage(raw));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (documentId: string) => {
    if (!token || !subId) return;
    if (!window.confirm('Delete this document from the knowledge base?')) return;
    setWriteErr('');
    setSaveOk('');
    setDeletingId(documentId);
    try {
      await deleteKbDocument(token, subId, documentId);
      setSaveOk('Document removed.');
      await load();
    } catch (er) {
      const raw = isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Delete failed';
      setWriteErr(friendlifyKbMessage(raw));
    } finally {
      setDeletingId(null);
    }
  };

  const onSearch = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;
    const form = e.currentTarget;
    const qel = form.elements.namedItem('kb-search-query') as HTMLInputElement | null;
    const q = (qel?.value ?? qSearch).trim();
    if (!q) return;
    setQSearch(q);
    setSearchErr('');
    setSearching(true);
    setSearchChunks(null);
    try {
      const r = await searchKb(token, { tenantId: subId, query: q, topK: 8 });
      setSearchChunks(Array.isArray(r.chunks) ? r.chunks : []);
    } catch (er) {
      const raw = er instanceof Error ? er.message : 'Search failed';
      setSearchErr(friendlifyKbMessage(raw));
    } finally {
      setSearching(false);
    }
  };

  const fmtStatus = (s: string) => {
    const u = s.toUpperCase();
    if (u === 'READY' || u === 'PROCESSING' || u === 'FAILED') return s;
    return s;
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.5rem 0.6rem',
    borderRadius: '6px',
    border: '1px solid #e2e8f0',
  };

  return (
    <div>
      <PageHeader title="Knowledge Base" eyebrow="This subaccount" />
      <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0 0 1.1rem', maxWidth: '44rem', lineHeight: 1.5 }}>
        Add FAQs, long-form text, and documents. Plain text and .txt work reliably. PDF, Word .doc, and .docx can be
        uploaded; if processing is not enabled for a format, the item may stay in a non-ready state—check the status
        column.
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1.5rem',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            flex: '1 1 480px',
            minWidth: 0,
            padding: '0 0 0.5rem 0',
          }}
        >
      {loadErr ? (
        <ErrorBanner message={loadErr} />
      ) : loading ? (
        <LoadingBlock message="Loading…" />
      ) : null}
      {writeErr ? <ErrorBanner message={writeErr} /> : null}
      {saveOk && !writeErr ? <SuccessBanner message={saveOk} /> : null}
      {loadErr ? (
        <button
          type="button"
          onClick={() => {
            setLoadErr('');
            bump();
          }}
          style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
        >
          Retry
        </button>
      ) : null}

      {!loadErr && !loading ? (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.45rem',
              marginBottom: '0.75rem',
            }}
            aria-label="Knowledge Base actions"
          >
            <button
              type="button"
              style={topAction}
              onClick={() => {
                setTab('faq');
                setSaveOk('');
              }}
            >
              Add FAQ
            </button>
            <button
              type="button"
              style={topAction}
              onClick={() => {
                setTab('rich');
                setSaveOk('');
              }}
            >
              Add Rich Text
            </button>
            <button
              type="button"
              style={topAction}
              onClick={() => {
                setTab('files');
                fileInputRef.current?.click();
              }}
            >
              Upload file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={onFileChange}
              style={{ display: 'none' }}
              accept=".txt,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            />
            {saving ? <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Working…</span> : null}
          </div>

          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0 0 0.6rem' }}>Start with a .txt upload to confirm ingestion end to end.</p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.9rem' }} role="tablist" aria-label="Content type">
            <button
              type="button"
              style={tabButton(tab === 'faq')}
              onClick={() => {
                setTab('faq');
                setSaveOk('');
              }}
              role="tab"
              aria-selected={tab === 'faq'}
            >
              FAQ
            </button>
            <button
              type="button"
              style={tabButton(tab === 'rich')}
              onClick={() => {
                setTab('rich');
                setSaveOk('');
              }}
              role="tab"
              aria-selected={tab === 'rich'}
            >
              Rich Text
            </button>
            <button
              type="button"
              style={tabButton(tab === 'files')}
              onClick={() => {
                setTab('files');
                setSaveOk('');
              }}
              role="tab"
              aria-selected={tab === 'files'}
            >
              Files
            </button>
          </div>

          {tab === 'faq' ? (
            <SectionCard title="FAQ" subtitle="Question and answer">
              <form onSubmit={onFaqSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '520px', marginBottom: '1.25rem' }}>
                <label>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '0.2rem' }}>Question</span>
                  <input
                    name="kb-faq-question"
                    value={faqQ}
                    onChange={e => {
                      setFaqQ(e.target.value);
                      setSaveOk('');
                    }}
                    required
                    style={inputStyle}
                    placeholder="Customer question"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '0.2rem' }}>Answer</span>
                  <textarea
                    name="kb-faq-answer"
                    value={faqA}
                    onChange={e => {
                      setFaqA(e.target.value);
                      setSaveOk('');
                    }}
                    required
                    rows={4}
                    style={inputStyle}
                    placeholder="Short answer"
                    autoComplete="off"
                  />
                </label>
                <button type="submit" disabled={saving} style={{ width: 'fit-content', padding: '0.45rem 0.85rem' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </form>

              {faqRows.length === 0 ? (
                <EmptyState compact title="No FAQ entries" detail="Add a FAQ above, or the list is empty." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>Title / question</th>
                        <th style={th}>Kind</th>
                        <th style={th}>Status</th>
                        <th style={th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faqRows.map(d => (
                        <tr key={d.id}>
                          <td style={td}>{d.title}</td>
                          <td style={td}>{d.documentKind ?? 'faq'}</td>
                          <td style={td}>{fmtStatus(d.status)}</td>
                          <td style={td}>
                            <button
                              type="button"
                              onClick={() => onDelete(d.id)}
                              disabled={deletingId === d.id}
                              style={{ fontSize: '0.75rem', color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                              {deletingId === d.id ? '…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          ) : null}

          {tab === 'rich' ? (
            <SectionCard title="Rich Text" subtitle="Longer reference content">
              <form onSubmit={onRichSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '520px', marginBottom: '1.25rem' }}>
                <label>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '0.2rem' }}>Title</span>
                  <input
                    name="kb-rich-title"
                    value={richTitle}
                    onChange={e => {
                      setRichTitle(e.target.value);
                      setSaveOk('');
                    }}
                    required
                    style={inputStyle}
                    placeholder="Title"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '0.2rem' }}>Text content</span>
                  <textarea
                    name="kb-rich-body"
                    value={richBody}
                    onChange={e => {
                      setRichBody(e.target.value);
                      setSaveOk('');
                    }}
                    required
                    rows={6}
                    style={inputStyle}
                    placeholder="Plain text (HTML can be added later server-side)"
                    autoComplete="off"
                  />
                </label>
                <button type="submit" disabled={saving} style={{ width: 'fit-content', padding: '0.45rem 0.85rem' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </form>

              {otherRows.length > 0 ? (
                <p style={{ fontSize: '0.78rem', color: '#78716c', background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: '6px', padding: '0.45rem 0.6rem' }}>
                  {otherRows.length} additional document(s) without a clear type are grouped with rich text. You can delete
                  and re-add if something looks wrong.
                </p>
              ) : null}

              {richRows.length === 0 ? (
                <EmptyState compact title="No rich text entries" detail="Add content above or upload legacy data." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>Title</th>
                        <th style={th}>Kind</th>
                        <th style={th}>Status</th>
                        <th style={th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {richRows.map(d => (
                        <tr key={d.id}>
                          <td style={td}>{d.title}</td>
                          <td style={td}>{d.documentKind ?? d.source}</td>
                          <td style={td}>{fmtStatus(d.status)}</td>
                          <td style={td}>
                            <button
                              type="button"
                              onClick={() => onDelete(d.id)}
                              disabled={deletingId === d.id}
                              style={{ fontSize: '0.75rem', color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                              {deletingId === d.id ? '…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          ) : null}

          {tab === 'files' ? (
            <SectionCard title="Files" subtitle="PDF, Word, and plain text—status shows processing or issues">
              <div
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  border: '1px dashed #94a3b8',
                  background: '#f8fafc',
                  color: '#334155',
                  cursor: 'pointer',
                  textAlign: 'center',
                  marginBottom: '0.9rem',
                }}
              >
                Drop a file or tap to choose (PDF, DOC, DOCX, or TXT)
              </div>
              {fileRows.length === 0 ? (
                <EmptyState compact title="No file documents" detail="Upload a .txt to verify ingestion, or add PDF/Word when extraction is on." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>File name</th>
                        <th style={th}>Kind</th>
                        <th style={th}>Type</th>
                        <th style={th}>Status</th>
                        <th style={th}>Uploaded</th>
                        <th style={th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileRows.map(d => (
                        <tr key={d.id}>
                          <td style={td}>{d.title}</td>
                          <td style={td}>{d.documentKind ?? 'file'}</td>
                          <td style={td}>{d.source}</td>
                          <td style={td}>{fmtStatus(d.status)}</td>
                          <td style={td}>{d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}</td>
                          <td style={td}>
                            <button
                              type="button"
                              onClick={() => onDelete(d.id)}
                              disabled={deletingId === d.id}
                              style={{ fontSize: '0.75rem', color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                              {deletingId === d.id ? '…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          ) : null}

          <SectionCard title="Search index" subtitle="Keyword retrieval across chunked content">
            <form onSubmit={onSearch} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                name="kb-search-query"
                value={qSearch}
                onChange={e => setQSearch(e.target.value)}
                placeholder="Query"
                autoComplete="off"
                style={{ minWidth: '200px', flex: 1, padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #d1d5db' }}
              />
              <button type="submit" disabled={searching} style={{ padding: '0.5rem 0.85rem' }}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>
            {searchErr ? <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{searchErr}</p> : null}
            {searchChunks && (
              <ol style={{ margin: '0.75rem 0 0', paddingLeft: '1.2rem', fontSize: '0.86rem' }}>
                {searchChunks.length === 0 ? (
                  <li>No results</li>
                ) : (
                  searchChunks.slice(0, 8).map((c, i) => (
                    <li key={i} style={{ marginBottom: '0.4rem' }}>
                      {typeof c === 'object' && c && 'content' in c
                        ? String((c as { content?: unknown }).content).slice(0, 200)
                        : String(c).slice(0, 200)}
                    </li>
                  ))
                )}
              </ol>
            )}
          </SectionCard>
        </>
      ) : null}
        </div>
        {token && !loadErr && !loading ? (
          <div
            style={{
              flex: '1.2 1 560px',
              width: '100%',
              minWidth: 'min(100%, 640px)',
              maxWidth: 'min(100%, 780px)',
              position: 'sticky' as const,
              top: '0.5rem',
              alignSelf: 'flex-start' as const,
            }}
          >
            <BotTestPanel token={token} subaccountId={subId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
