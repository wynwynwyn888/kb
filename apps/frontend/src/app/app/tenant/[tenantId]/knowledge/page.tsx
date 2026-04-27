'use client';

import type { CSSProperties } from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stripModelThinking } from '@aisbp/formatter';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  createKbFaq,
  createKbRichText,
  deleteKbDocument,
  getKbDocumentChunks,
  isApiHttpError,
  listKbDocuments,
  searchKb,
  updateKbFaq,
  uploadKbFile,
  type KbDocumentRow,
} from '@/lib/api';
import {
  ErrorBanner,
  EmptyState,
  LoadingBlock,
  SuccessBanner,
  StatusPill,
  mvpPrimaryButtonStyle,
  mvpSecondaryButtonStyle,
  mvpInputStyle,
  mvpLabelStyle,
} from '@/components/app/mvp-ui';
import { BotTestPanel } from '@/components/app/bot-test/BotTestPanel';

const PRIMARY = '#0F62FE';
const PAGE_BG = '#F8FAFC';

const glassSection: CSSProperties = {
  borderRadius: 16,
  padding: '1.15rem 1.2rem',
  marginBottom: '1.1rem',
  background: 'rgba(255, 255, 255, 0.88)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  border: '1px solid rgba(226, 232, 240, 0.95)',
  boxShadow: '0 12px 40px rgba(15, 23, 42, 0.04)',
};

const docCard: CSSProperties = {
  borderRadius: 14,
  padding: '1.05rem 1.1rem',
  marginBottom: 12,
  background: 'rgba(255, 255, 255, 0.92)',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  position: 'relative',
  transition: 'border-color 0.15s ease',
};

const bentoBtn: CSSProperties = {
  borderRadius: 14,
  padding: '1.25rem 0.75rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  background: 'rgba(255, 255, 255, 0.9)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(255, 255, 255, 1)',
  boxShadow: '0 12px 40px rgba(15, 23, 42, 0.05)',
  cursor: 'pointer',
  font: 'inherit',
  color: '#0f172a',
};

function relativeTimeLabel(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))}h ago`;
  if (sec < 86400 * 14) return `${Math.max(1, Math.floor(sec / 86400))}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusPillTone(status: string): 'ok' | 'neutral' | 'warn' | 'bad' {
  const u = status.toUpperCase();
  if (u === 'READY' || u === 'ACTIVE') return 'ok';
  if (u === 'FAILED' || u === 'ERROR' || u === 'INVALID') return 'bad';
  if (u === 'PROCESSING' || u === 'PENDING' || u === 'DRAFT') return 'warn';
  return 'neutral';
}

function KnowledgeDocCard({
  title,
  statusRaw,
  subtitle,
  timeLabel,
  timePrefix = 'Updated',
  usageLine,
  onDelete,
  deleting,
}: {
  title: string;
  statusRaw: string;
  subtitle?: string;
  timeLabel: string;
  timePrefix?: string;
  usageLine?: string;
  onDelete: () => void;
  deleting: boolean;
}) {
  const fmtStatus = (s: string) => {
    const u = s.toUpperCase();
    if (u === 'READY') return 'Ready';
    if (u === 'PROCESSING') return 'Processing';
    if (u === 'DRAFT') return 'Draft';
    if (u === 'FAILED') return 'Needs attention';
    return s;
  };

  return (
    <article
      style={docCard}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(191, 219, 254, 0.95)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(226, 232, 240, 0.9)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: '#0f172a', lineHeight: 1.35, flex: 1, minWidth: 0 }}>
          {title}
        </h3>
        <StatusPill label={fmtStatus(statusRaw)} tone={statusPillTone(statusRaw)} />
      </div>
      {subtitle ? (
        <p
          style={{
            fontSize: '0.8125rem',
            color: '#64748b',
            margin: '0 0 10px',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }}
        >
          {subtitle}
        </p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 18px', marginTop: 4 }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', color: '#94a3b8' }}>
          {timePrefix} {timeLabel}
        </span>
        {usageLine ? (
          <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', color: '#94a3b8' }}>{usageLine}</span>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#b91c1c',
            background: 'none',
            border: 'none',
            cursor: deleting ? 'wait' : 'pointer',
            padding: '2px 0',
          }}
        >
          {deleting ? '…' : 'Delete'}
        </button>
      </div>
    </article>
  );
}

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

function fmtKind(s: string | null | undefined) {
  const u = (s ?? '').toLowerCase();
  if (u === 'faq') return 'FAQ';
  if (u === 'rich_text' || u === 'rich' || u === 'manual') return 'Note';
  if (u === 'file') return 'File';
  return s || 'Note';
}

const faqCardShell: CSSProperties = {
  borderRadius: 16,
  padding: '1.15rem 1.25rem',
  marginBottom: 14,
  background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)',
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 24px rgba(15, 23, 42, 0.055)',
};

function faqListStatusLabel(s: string): string {
  const u = s.toUpperCase();
  if (u === 'READY') return 'Ready';
  if (u === 'PENDING' || u === 'PROCESSING') return 'Indexing';
  if (u === 'DRAFT') return 'Draft';
  if (u === 'FAILED') return 'Needs attention';
  return s;
}

function FaqKnowledgeCard({
  doc,
  token,
  subId,
  deleting,
  onDelete,
  onUpdated,
  setWriteErr,
  setSaveOk,
}: {
  doc: KbDocumentRow;
  token: string;
  subId: string;
  deleting: boolean;
  onDelete: () => void;
  onUpdated: () => void;
  setWriteErr: (s: string) => void;
  setSaveOk: (s: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editQ, setEditQ] = useState('');
  const [editA, setEditA] = useState('');
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const question =
    doc.faqQuestion?.trim() || doc.title.replace(/^FAQ:\s*/i, '').trim() || doc.title;
  const preview = (doc.answerPreview ?? '').trim();
  const needsShowMore = preview.length > 160 || preview.split(/\n/).length > 4;

  const startEdit = async () => {
    setEditing(true);
    setEditQ(question);
    setEditA('');
    setWriteErr('');
    setSaveOk('');
    setLoadingEdit(true);
    try {
      const chunks = await getKbDocumentChunks(token, subId, doc.id);
      const body = chunks[0]?.content ?? preview;
      setEditA(body);
    } catch {
      setEditA(preview);
    } finally {
      setLoadingEdit(false);
    }
  };

  const saveEdit = async () => {
    const q = editQ.trim();
    const a = editA.trim();
    if (!q || !a) {
      setWriteErr('Question and answer are required.');
      return;
    }
    setSavingEdit(true);
    setWriteErr('');
    try {
      await updateKbFaq(token, doc.id, { tenantId: subId, question: q, answer: a });
      setSaveOk('FAQ saved.');
      setEditing(false);
      onUpdated();
    } catch (er) {
      const raw = isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Save failed';
      setWriteErr(friendlifyKbMessage(raw));
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <article style={faqCardShell}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#94a3b8',
              margin: '0 0 0.35rem',
              textTransform: 'uppercase' as const,
            }}
          >
            Question
          </p>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: '#0f172a', lineHeight: 1.4 }}>
            {question}
          </h3>
        </div>
        <StatusPill label={faqListStatusLabel(doc.status)} tone={statusPillTone(doc.status)} />
      </div>

      {!editing ? (
        <>
          <p
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#94a3b8',
              margin: '1rem 0 0.35rem',
              textTransform: 'uppercase' as const,
            }}
          >
            Answer
          </p>
          {preview ? (
            <div
              style={
                expanded
                  ? {
                      fontSize: '0.875rem',
                      color: '#475569',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap' as const,
                      maxHeight: 260,
                      overflowY: 'auto' as const,
                    }
                  : {
                      fontSize: '0.875rem',
                      color: '#475569',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap' as const,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical' as const,
                      overflow: 'hidden',
                    }
              }
            >
              {preview}
            </div>
          ) : (
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No answer text yet.</p>
          )}
          {needsShowMore && !expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                marginTop: 8,
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: PRIMARY,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Show more
            </button>
          ) : null}
          {expanded && needsShowMore ? (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{
                marginTop: 8,
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#64748b',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Show less
            </button>
          ) : null}
        </>
      ) : (
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <label>
            <span style={mvpLabelStyle}>Question</span>
            <input
              value={editQ}
              onChange={e => setEditQ(e.target.value)}
              style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%' }}
              disabled={loadingEdit}
            />
          </label>
          <label>
            <span style={mvpLabelStyle}>Answer</span>
            <textarea
              value={editA}
              onChange={e => setEditA(e.target.value)}
              rows={6}
              style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%', minHeight: 140, resize: 'vertical' as const }}
              disabled={loadingEdit}
            />
          </label>
          {loadingEdit ? (
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>Loading answer…</p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={savingEdit || loadingEdit}
              onClick={() => void saveEdit()}
              style={{ ...mvpPrimaryButtonStyle, borderRadius: 10 }}
            >
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              disabled={savingEdit}
              onClick={() => {
                setEditing(false);
                setExpanded(false);
              }}
              style={{ ...mvpSecondaryButtonStyle, borderRadius: 10 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px 16px',
          marginTop: '1.1rem',
          paddingTop: '0.85rem',
          borderTop: '1px solid #f1f5f9',
        }}
      >
        <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', color: '#94a3b8' }}>
          {fmtKind(doc.documentKind ?? 'faq')} · {typeof doc.chunkCount === 'number' ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}` : '—'}
        </span>
        <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>·</span>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', color: '#94a3b8' }}>
          Updated {relativeTimeLabel(doc.createdAt)}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {!editing ? (
            <button
              type="button"
              onClick={() => void startEdit()}
              style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: PRIMARY,
                background: 'rgba(15, 98, 254, 0.08)',
                border: '1px solid rgba(15, 98, 254, 0.25)',
                borderRadius: 10,
                padding: '0.4rem 0.85rem',
                cursor: 'pointer',
              }}
            >
              View / Edit
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            style={{
              fontSize: '0.75rem',
              fontWeight: 500,
              color: '#94a3b8',
              background: 'none',
              border: 'none',
              cursor: deleting ? 'wait' : 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {deleting ? 'Removing…' : 'Delete'}
          </button>
        </div>
      </div>
    </article>
  );
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
      setSaveOk('Note saved.');
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

  const tabUnderline = (active: boolean): CSSProperties => ({
    fontSize: '0.875rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    padding: '0 2px 14px',
    marginBottom: -1,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: active ? PRIMARY : '#64748b',
    borderBottom: active ? `2px solid ${PRIMARY}` : '2px solid transparent',
  });

  const iconCircle: CSSProperties = {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'rgba(15, 98, 254, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.35rem',
    lineHeight: 1,
  };

  return (
    <div style={{ background: PAGE_BG, padding: '0 0 1.75rem', minHeight: '100%' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <header style={{ marginBottom: '1.35rem' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, margin: 0, lineHeight: 1.2, color: '#0f172a', letterSpacing: '-0.03em' }}>
            Knowledge
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0.5rem 0 0', maxWidth: '36rem', lineHeight: 1.55 }}>
            Manage the information your bot uses to answer customer questions.
          </p>
        </header>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.5rem',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: '1 1 520px', minWidth: 0 }}>
            {loadErr ? <ErrorBanner message={loadErr} /> : null}
            {loading ? <LoadingBlock message="Loading…" /> : null}
            {writeErr ? <ErrorBanner message={writeErr} /> : null}
            {saveOk && !writeErr ? <SuccessBanner message={saveOk} /> : null}
            {loadErr ? (
              <button
                type="button"
                onClick={() => {
                  setLoadErr('');
                  bump();
                }}
                style={{ ...mvpSecondaryButtonStyle, marginTop: '0.5rem' }}
              >
                Retry
              </button>
            ) : null}

            {!loadErr && !loading ? (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '0.75rem',
                    marginBottom: '1.35rem',
                  }}
                  aria-label="Knowledge actions"
                >
                  <button
                    type="button"
                    style={bentoBtn}
                    onClick={() => {
                      setTab('rich');
                      setSaveOk('');
                    }}
                  >
                    <span style={iconCircle}>📝</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Add note</span>
                  </button>
                  <button
                    type="button"
                    style={bentoBtn}
                    onClick={() => {
                      setTab('files');
                      fileInputRef.current?.click();
                    }}
                  >
                    <span style={iconCircle}>📤</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Upload file</span>
                  </button>
                  <button
                    type="button"
                    style={bentoBtn}
                    onClick={() => {
                      setTab('faq');
                      setSaveOk('');
                    }}
                  >
                    <span style={iconCircle}>❓</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Add FAQ</span>
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={onFileChange}
                  style={{ display: 'none' }}
                  accept=".txt,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                />
                {saving ? (
                  <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 1rem' }}>Working…</p>
                ) : null}

                <div
                  style={{
                    display: 'flex',
                    gap: '1.5rem',
                    borderBottom: '1px solid #e2e8f0',
                    marginBottom: '1.1rem',
                  }}
                  role="tablist"
                  aria-label="Content type"
                >
                  <button
                    type="button"
                    style={tabUnderline(tab === 'faq')}
                    onClick={() => {
                      setTab('faq');
                      setSaveOk('');
                    }}
                    role="tab"
                    aria-selected={tab === 'faq'}
                  >
                    FAQs
                  </button>
                  <button
                    type="button"
                    style={tabUnderline(tab === 'rich')}
                    onClick={() => {
                      setTab('rich');
                      setSaveOk('');
                    }}
                    role="tab"
                    aria-selected={tab === 'rich'}
                  >
                    Notes
                  </button>
                  <button
                    type="button"
                    style={tabUnderline(tab === 'files')}
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
                  <section style={glassSection}>
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.2rem', color: '#0f172a' }}>Approved FAQ</h2>
                    <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45 }}>
                      Add approved answers your bot can use when replying.
                    </p>
                    <form onSubmit={onFaqSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 520, marginBottom: '1.25rem' }}>
                      <label>
                        <span style={mvpLabelStyle}>Question</span>
                        <input
                          name="kb-faq-question"
                          value={faqQ}
                          onChange={e => {
                            setFaqQ(e.target.value);
                            setSaveOk('');
                          }}
                          required
                          style={{ ...mvpInputStyle, marginTop: '0.35rem' }}
                          placeholder="e.g. What are your opening hours?"
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        <span style={mvpLabelStyle}>Answer</span>
                        <textarea
                          name="kb-faq-answer"
                          value={faqA}
                          onChange={e => {
                            setFaqA(e.target.value);
                            setSaveOk('');
                          }}
                          required
                          rows={4}
                          style={{ ...mvpInputStyle, marginTop: '0.35rem', minHeight: 100, resize: 'vertical' as const }}
                          placeholder="Write the approved answer…"
                          autoComplete="off"
                        />
                      </label>
                      <button type="submit" disabled={saving} style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}>
                        {saving ? 'Saving…' : 'Save FAQ'}
                      </button>
                    </form>

                    {faqRows.length === 0 ? (
                      <EmptyState
                        compact
                        title="No answers yet"
                        detail="Add your first FAQ to help the bot answer common customer questions."
                      />
                    ) : (
                      <div>
                        {faqRows.map(d => (
                          <FaqKnowledgeCard
                            key={d.id}
                            doc={d}
                            token={token!}
                            subId={subId}
                            deleting={deletingId === d.id}
                            onDelete={() => onDelete(d.id)}
                            onUpdated={() => {
                              bump();
                            }}
                            setWriteErr={setWriteErr}
                            setSaveOk={setSaveOk}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}

                {tab === 'rich' ? (
                  <section style={glassSection}>
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.2rem', color: '#0f172a' }}>Notes</h2>
                    <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45 }}>
                      Longer context such as policies, menus, or service details.
                    </p>
                    <form onSubmit={onRichSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 520, marginBottom: '1.25rem' }}>
                      <label>
                        <span style={mvpLabelStyle}>Title</span>
                        <input
                          name="kb-rich-title"
                          value={richTitle}
                          onChange={e => {
                            setRichTitle(e.target.value);
                            setSaveOk('');
                          }}
                          required
                          style={{ ...mvpInputStyle, marginTop: '0.35rem' }}
                          placeholder="Title"
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        <span style={mvpLabelStyle}>Text content</span>
                        <textarea
                          name="kb-rich-body"
                          value={richBody}
                          onChange={e => {
                            setRichBody(e.target.value);
                            setSaveOk('');
                          }}
                          required
                          rows={6}
                          style={{ ...mvpInputStyle, marginTop: '0.35rem', minHeight: 140, resize: 'vertical' as const }}
                          placeholder="Paste plain text your bot should know"
                          autoComplete="off"
                        />
                      </label>
                      <button type="submit" disabled={saving} style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}>
                        {saving ? 'Saving…' : 'Save note'}
                      </button>
                    </form>

                    {otherRows.length > 0 ? (
                      <p
                        style={{
                          fontSize: '0.78rem',
                          color: '#78716c',
                          background: 'rgba(250, 250, 249, 0.9)',
                          border: '1px solid #e7e5e4',
                          borderRadius: 10,
                          padding: '0.5rem 0.65rem',
                          marginBottom: '0.85rem',
                        }}
                      >
                        {otherRows.length} additional item(s) are grouped with notes. You can delete and re-add if something looks wrong.
                      </p>
                    ) : null}

                    {richRows.length === 0 ? (
                      <EmptyState compact title="No notes yet" detail="Add business details, policies, hours, or service context above." />
                    ) : (
                      <div>
                        {richRows.map(d => (
                          <KnowledgeDocCard
                            key={d.id}
                            title={d.title}
                            statusRaw={d.status}
                            subtitle={`${fmtKind(d.documentKind ?? d.source)}`}
                            timeLabel={relativeTimeLabel(d.createdAt)}
                            usageLine={
                              typeof d.chunkCount === 'number' && d.chunkCount > 0
                                ? `${d.chunkCount} chunk${d.chunkCount === 1 ? '' : 's'}`
                                : undefined
                            }
                            onDelete={() => onDelete(d.id)}
                            deleting={deletingId === d.id}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}

                {tab === 'files' ? (
                  <section style={glassSection}>
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.2rem', color: '#0f172a' }}>Files</h2>
                    <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45 }}>
                      Upload PDF, Word, or plain text files for the bot to use.
                    </p>
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
                        fontSize: '0.8125rem',
                        padding: '1rem 1.1rem',
                        borderRadius: 12,
                        border: '1px dashed #94a3b8',
                        background: 'rgba(248, 250, 252, 0.8)',
                        color: '#334155',
                        cursor: 'pointer',
                        textAlign: 'center',
                        marginBottom: '1rem',
                      }}
                    >
                      Choose a file to upload (PDF, DOC, DOCX, or TXT)
                    </div>
                    {fileRows.length === 0 ? (
                      <EmptyState compact title="No files yet" detail="Upload a document your bot should reference." />
                    ) : (
                      <div>
                        {fileRows.map(d => (
                          <KnowledgeDocCard
                            key={d.id}
                            title={d.title}
                            statusRaw={d.status}
                            subtitle={`${fmtKind(d.documentKind ?? 'file')} · ${fmtKind(d.source)}`}
                            timePrefix="Uploaded"
                            timeLabel={d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}
                            onDelete={() => onDelete(d.id)}
                            deleting={deletingId === d.id}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}

                <section style={glassSection}>
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.2rem', color: '#0f172a' }}>Search knowledge</h2>
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 0.85rem', lineHeight: 1.45 }}>
                    Check what the bot can retrieve from this workspace.
                  </p>
                  <form onSubmit={onSearch} style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      name="kb-search-query"
                      value={qSearch}
                      onChange={e => setQSearch(e.target.value)}
                      placeholder="Search question or phrase"
                      autoComplete="off"
                      style={{
                        ...mvpInputStyle,
                        flex: 1,
                        minWidth: 200,
                        borderRadius: 999,
                        background: '#f1f5f9',
                        border: '1px solid transparent',
                      }}
                    />
                    <button type="submit" disabled={searching} style={{ ...mvpPrimaryButtonStyle, borderRadius: 10 }}>
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                  </form>
                  {searchErr ? <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.65rem' }}>{searchErr}</p> : null}
                  {searchChunks && (
                    <ol style={{ margin: '0.85rem 0 0', paddingLeft: '1.15rem', fontSize: '0.875rem', color: '#334155' }}>
                      {searchChunks.length === 0 ? (
                        <li>No matching knowledge found</li>
                      ) : (
                        searchChunks.slice(0, 8).map((c, i) => (
                          <li key={i} style={{ marginBottom: '0.45rem' }}>
                            {typeof c === 'object' && c && 'content' in c
                              ? stripModelThinking(String((c as { content?: unknown }).content)).slice(0, 200)
                              : stripModelThinking(String(c)).slice(0, 200)}
                          </li>
                        ))
                      )}
                    </ol>
                  )}
                </section>
              </>
            ) : null}
          </div>

          {token && !loadErr && !loading ? (
            <div
              style={{
                flex: '1 1 340px',
                width: '100%',
                minWidth: 'min(100%, 300px)',
                maxWidth: 460,
                position: 'sticky' as const,
                top: 12,
                alignSelf: 'flex-start' as const,
              }}
            >
              <BotTestPanel token={token} subaccountId={subId} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
