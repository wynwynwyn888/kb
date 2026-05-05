'use client';

import type { CSSProperties, ReactNode } from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stripModelThinking } from '@aisbp/formatter';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  createKbFaq,
  createKbRichText,
  createKbVault,
  duplicateKbVault,
  deleteKbDocument,
  deleteKbVault,
  downloadKbDocumentOriginal,
  getKbDocumentChunks,
  getKbRichNoteSource,
  isApiHttpError,
  listKbDocuments,
  listKbVaults,
  searchKb,
  setKbDocumentVault,
  updateKbFaq,
  updateKbRichText,
  updateKbVault,
  uploadKbFile,
  type KbDocumentRow,
  type KbRichNoteSource,
  type KbRichTextDocumentPayload,
  type KbSearchHit,
  type KbVaultRow,
} from '@/lib/api';
import {
  knowledgeSearchPlaceholder,
  resolveSelectedVaultId,
  vaultScopedDocuments,
} from '@/lib/knowledge-vault-scope';
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
import { relativeTimeLabel } from '@/lib/datetime-display';

const PRIMARY = '#0F62FE';
const PAGE_BG = 'var(--aisbp-page-bg, #F8FAFC)';

const NO_VAULT_EMPTY_MSG = 'Create a knowledge vault before adding knowledge.';

function vaultListCardStyle(selected: boolean): CSSProperties {
  return {
    padding: '0.75rem 0.85rem',
    borderRadius: 12,
    border: '1px solid rgba(226, 232, 240, 0.92)',
    borderLeftWidth: 3,
    borderLeftStyle: 'solid',
    borderLeftColor: selected ? 'rgba(15, 98, 254, 0.72)' : 'transparent',
    background: selected ? 'rgba(248, 250, 252, 0.98)' : 'var(--aisbp-surface, #fff)',
    boxShadow: selected ? '0 1px 4px rgba(15, 23, 42, 0.05)' : '0 1px 2px rgba(15, 23, 42, 0.03)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    font: 'inherit',
    width: '100%',
    display: 'block',
  };
}

const glassSection: CSSProperties = {
  borderRadius: 16,
  padding: '1.15rem 1.25rem',
  marginBottom: '1.15rem',
  background: 'var(--aisbp-glass-bg, rgba(255, 255, 255, 0.94))',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  border: 'none',
  boxShadow: '0 4px 28px rgba(15, 23, 42, 0.06)',
};

const bentoBtn: CSSProperties = {
  borderRadius: 14,
  padding: '1.25rem 0.75rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  background: 'var(--aisbp-bento-bg, rgba(255, 255, 255, 0.9))',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid var(--aisbp-bento-border, rgba(255, 255, 255, 1))',
  boxShadow: '0 12px 40px rgba(15, 23, 42, 0.05)',
  cursor: 'pointer',
  font: 'inherit',
  color: 'var(--aisbp-text-heading, #0f172a)',
};

function kbSearchRelevanceLabelDisplay(h: KbSearchHit): string {
  const m: Record<string, string> = {
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
    BEST_EFFORT: 'Best match',
  };
  if (h.relevanceLabel) return m[h.relevanceLabel] ?? h.relevanceLabel;
  if (h.bestEffort) return 'Best match';
  return 'Related';
}

function kbSearchHitKindLabel(kind: string | null | undefined): string {
  const k = (kind ?? '').trim().toLowerCase();
  if (k === 'faq') return 'FAQ';
  if (k === 'rich_text') return 'Note';
  if (k === 'file') return 'Uploaded file';
  if (k.includes('/')) return 'Uploaded file';
  return kind?.trim() ? kind : 'Knowledge';
}

function kbSearchHitTargetTab(hit: KbSearchHit): 'faq' | 'rich' | 'files' {
  const k = (hit.kind ?? '').trim().toLowerCase();
  if (k === 'faq') return 'faq';
  if (k === 'file' || k.includes('/')) return 'files';
  return 'rich';
}

type KbSearchTraceView =
  | { mode: 'rich'; title: string; rich: KbRichNoteSource }
  | {
      mode: 'chunks';
      title: string;
      chunks: Array<{ id: string; content: string; tokenCount?: number; metadata?: Record<string, unknown> }>;
    };

function statusPillTone(status: string): 'ok' | 'neutral' | 'warn' | 'bad' {
  const u = status.toUpperCase();
  if (u === 'READY' || u === 'ACTIVE') return 'ok';
  if (u === 'FAILED' || u === 'ERROR' || u === 'INVALID') return 'bad';
  if (u === 'PROCESSING' || u === 'PENDING' || u === 'DRAFT') return 'warn';
  return 'neutral';
}

const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--aisbp-overlay, rgba(15, 23, 42, 0.48))',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modalPanel: CSSProperties = {
  background: 'var(--aisbp-modal-bg, #fff)',
  borderRadius: 16,
  width: 'min(720px, 100%)',
  maxHeight: 'min(82vh, 760px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 24px 48px rgba(15, 23, 42, 0.2)',
  border: '1px solid var(--aisbp-modal-border, #e2e8f0)',
};

const modalPanelWide: CSSProperties = {
  ...modalPanel,
  width: 'min(920px, 100%)',
  maxHeight: 'min(88vh, 820px)',
};

function KbModal({
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      style={modalOverlay}
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={wide ? modalPanelWide : modalPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '1rem 1.15rem', borderBottom: '1px solid var(--aisbp-modal-divider, #f1f5f9)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 id="kb-modal-title" style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, flex: 1, minWidth: 0, color: 'var(--aisbp-text-heading, #0f172a)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'var(--aisbp-modal-close-bg, #f1f5f9)',
              borderRadius: 8,
              width: 36,
              height: 36,
              cursor: 'pointer',
              fontSize: '1.1rem',
              lineHeight: 1,
              color: 'var(--aisbp-muted, #475569)',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: '1rem 1.15rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>{children}</div>
        {footer ? <div style={{ padding: '0.75rem 1.15rem', borderTop: '1px solid var(--aisbp-modal-divider, #f1f5f9)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

function formatFileBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKindLabel(doc: KbDocumentRow): string {
  const mt = (doc.mimeType ?? '').toLowerCase();
  if (mt.includes('pdf')) return 'PDF';
  if (mt.includes('word') || mt.includes('msword') || mt.includes('wordprocessingml')) return 'Word';
  if (mt.startsWith('text/')) return 'Text';
  const s = (doc.source ?? '').toLowerCase();
  if (s.includes('pdf')) return 'PDF';
  if (s.includes('word') || s.includes('document')) return 'Word';
  if (s.includes('text') || s.includes('plain')) return 'Text';
  return doc.mimeType?.split('/')[1]?.toUpperCase() || 'File';
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
  if (l.includes('move or delete this vault') && l.includes('knowledge items')) {
    return "Move or delete this vault's knowledge items before deleting the vault.";
  }
  if (l.includes('cannot delete the default vault')) {
    return 'The default vault cannot be deleted.';
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
  marginBottom: 18,
  background: 'linear-gradient(180deg, var(--aisbp-card-gradient-top, #ffffff) 0%, var(--aisbp-card-gradient-bottom, #fafbfc) 100%)',
  border: 'none',
  boxShadow: '0 2px 16px rgba(15, 23, 42, 0.06)',
};

function KbVaultPill({ name }: { name: string }) {
  const label = name.trim() || 'Unassigned';
  return (
    <span
      title={label}
      style={{
        display: 'inline-block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap' as const,
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase' as const,
        color: '#475569',
        background: '#f1f5f9',
        border: '1px solid #e2e8f0',
        borderRadius: 999,
        padding: '0.22rem 0.6rem',
      }}
    >
      {label}
    </span>
  );
}

function faqListStatusLabel(s: string): string {
  const u = s.toUpperCase();
  if (u === 'READY') return 'Ready';
  if (u === 'PENDING' || u === 'PROCESSING') return 'Indexing';
  if (u === 'DRAFT') return 'Draft';
  if (u === 'FAILED') return 'Needs attention';
  return s;
}

function DocumentVaultLine({
  doc,
  vaults,
  token,
  subId,
  vaultAssignBusy,
  onVaultAssignBusy,
  onPatchDocVault,
  setSaveOk,
  setWriteErr,
  inVaultView,
}: {
  doc: KbDocumentRow;
  vaults: KbVaultRow[];
  token: string;
  subId: string;
  vaultAssignBusy: boolean;
  onVaultAssignBusy: (busy: boolean) => void;
  onPatchDocVault: (documentId: string, vaultId: string, vaultName: string | null) => void;
  setSaveOk: (s: string) => void;
  setWriteErr: (s: string) => void;
  inVaultView?: boolean;
}) {
  const fallbackId = vaults[0]?.id ?? '';
  const selectValue = doc.vaultId ?? fallbackId;

  if (vaults.length === 0) {
    return (
      <p style={{ margin: '0.85rem 0 0', fontSize: '0.78rem', color: '#78716c', lineHeight: 1.45 }}>
        No knowledge vaults yet. Create one in the Knowledge Vaults section above.
      </p>
    );
  }

  return (
    <div
      style={{
        marginTop: '0.6rem',
        padding: '0.75rem 0.85rem',
        borderRadius: 12,
        background: 'rgba(248, 250, 252, 0.95)',
        border: '1px solid rgba(226, 232, 240, 0.95)',
      }}
    >
      <label htmlFor={`kb-vault-${doc.id}`} style={{ ...mvpLabelStyle, display: 'block', marginBottom: '0.4rem' }}>
        {inVaultView ? 'Move to another vault' : 'Assign to vault'}
      </label>
      <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 0.5rem', lineHeight: 1.4 }}>
        {inVaultView
          ? 'Pick another vault to move this item into. Live replies still use the vaults chosen on Bot Instructions → Assistant Profile.'
          : 'Choose which vault this item belongs to. Assistant profiles can search all vaults or only selected ones.'}
      </p>
      <select
        id={`kb-vault-${doc.id}`}
        value={selectValue || fallbackId}
        disabled={vaultAssignBusy}
        onChange={e => {
          const vid = e.target.value;
          void (async () => {
            if (!vid || vid === (doc.vaultId ?? '')) return;
            onVaultAssignBusy(true);
            setWriteErr('');
            try {
              await setKbDocumentVault(token, doc.id, { tenantId: subId, vaultId: vid });
              const name = vaults.find(v => v.id === vid)?.name ?? null;
              onPatchDocVault(doc.id, vid, name);
              setSaveOk('Vault updated.');
            } catch (er) {
              const raw = isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Could not move document';
              setWriteErr(friendlifyKbMessage(raw));
            } finally {
              onVaultAssignBusy(false);
            }
          })();
        }}
        style={{ ...mvpInputStyle, maxWidth: '100%', width: 'min(420px, 100%)' }}
      >
        {vaults.map(v => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.isDefault ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function FaqKnowledgeCard({
  doc,
  token,
  subId,
  deleting,
  onDelete,
  onUpdated,
  vaults,
  vaultAssignBusy,
  onVaultAssignBusy,
  onPatchDocVault,
  setWriteErr,
  setSaveOk,
  inVaultView = false,
}: {
  doc: KbDocumentRow;
  token: string;
  subId: string;
  deleting: boolean;
  onDelete: () => void;
  onUpdated: () => void;
  vaults: KbVaultRow[];
  vaultAssignBusy: boolean;
  onVaultAssignBusy: (busy: boolean) => void;
  onPatchDocVault: (documentId: string, vaultId: string, vaultName: string | null) => void;
  setWriteErr: (s: string) => void;
  setSaveOk: (s: string) => void;
  inVaultView?: boolean;
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {inVaultView ? (
            <span style={{ fontSize: '0.72rem', fontWeight: 500, color: '#94a3b8' }}>In this vault</span>
          ) : (
            <KbVaultPill name={doc.vaultName?.trim() || 'Unassigned'} />
          )}
          <StatusPill label={faqListStatusLabel(doc.status)} tone={statusPillTone(doc.status)} />
        </div>
      </div>

      <DocumentVaultLine
        doc={doc}
        vaults={vaults}
        token={token}
        subId={subId}
        vaultAssignBusy={vaultAssignBusy}
        onVaultAssignBusy={onVaultAssignBusy}
        onPatchDocVault={onPatchDocVault}
        setSaveOk={setSaveOk}
        setWriteErr={setWriteErr}
        inVaultView={inVaultView}
      />

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
          borderTop: '1px solid rgba(241, 245, 249, 0.95)',
        }}
      >
        <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', color: '#94a3b8' }}>
          {fmtKind(doc.documentKind ?? 'faq')} · {typeof doc.chunkCount === 'number' ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}` : '—'}
        </span>
        <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>·</span>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', color: '#94a3b8' }}>
          Updated {relativeTimeLabel(doc.updatedAt ?? doc.createdAt)}
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

function NoteKnowledgeCard({
  doc,
  token,
  subId,
  deleting,
  onDelete,
  onPatchedDocument,
  vaults,
  vaultAssignBusy,
  onVaultAssignBusy,
  onPatchDocVault,
  setWriteErr,
  setSaveOk,
  inVaultView = false,
}: {
  doc: KbDocumentRow;
  token: string;
  subId: string;
  deleting: boolean;
  onDelete: () => void;
  /** Merge PATCH payload into list state so updatedAt / preview refresh without full reload. */
  onPatchedDocument?: (payload: KbRichTextDocumentPayload) => void;
  vaults: KbVaultRow[];
  vaultAssignBusy: boolean;
  onVaultAssignBusy: (busy: boolean) => void;
  onPatchDocVault: (documentId: string, vaultId: string, vaultName: string | null) => void;
  setWriteErr: (s: string) => void;
  setSaveOk: (s: string) => void;
  inVaultView?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [loadingModal, setLoadingModal] = useState(false);
  const [savingModal, setSavingModal] = useState(false);
  /** Snapshot from GET rich-source (or fallback) for modal metadata while open */
  const [editorFacts, setEditorFacts] = useState<{ updatedAt: string; chunkCount: number } | null>(null);

  const preview = (doc.answerPreview ?? '').trim();
  const previewLines = preview ? preview.split('\n').length : 0;
  const needsShowMore = preview.length > 260 || previewLines > 4;

  const openModal = async () => {
    setModalOpen(true);
    setEditTitle(doc.title);
    setEditBody('');
    setEditorFacts(null);
    setWriteErr('');
    setSaveOk('');
    setLoadingModal(true);
    try {
      const src = await getKbRichNoteSource(token, subId, doc.id);
      setEditTitle(src.title);
      setEditBody(src.content.trim() || preview);
      setEditorFacts({ updatedAt: src.updatedAt, chunkCount: src.chunkCount });
    } catch {
      try {
        const chunks = await getKbDocumentChunks(token, subId, doc.id);
        const ordered = [...chunks].sort((a, b) => {
          const ma = (a.metadata ?? {}) as Record<string, unknown>;
          const mb = (b.metadata ?? {}) as Record<string, unknown>;
          const ia = Number(ma['sectionIndex']);
          const ib = Number(mb['sectionIndex']);
          const pa = Number(ma['sectionPartIndex'] ?? 0);
          const pb = Number(mb['sectionPartIndex'] ?? 0);
          const na = Number.isFinite(ia) ? ia : 0;
          const nb = Number.isFinite(ib) ? ib : 0;
          if (na !== nb) return na - nb;
          return pa - pb;
        });
        const body =
          ordered
            .map(c => {
              const ma = c.metadata as Record<string, unknown> | undefined;
              const st = typeof ma?.['sectionTitle'] === 'string' ? String(ma['sectionTitle']).trim() : '';
              const partIdx = Number(ma?.['sectionPartIndex'] ?? 0);
              const text = (c.content ?? '').trim();
              if (st && text) {
                if (!Number.isFinite(partIdx) || partIdx === 0) return `${st}\n${text}`;
                return text;
              }
              return text;
            })
            .filter(Boolean)
            .join('\n\n') || preview;
        setEditBody(body);
        setEditorFacts({
          updatedAt: doc.updatedAt ?? doc.createdAt ?? '',
          chunkCount: typeof doc.chunkCount === 'number' ? doc.chunkCount : chunks.length,
        });
      } catch {
        setEditBody(preview);
        setEditorFacts({
          updatedAt: doc.updatedAt ?? doc.createdAt ?? '',
          chunkCount: typeof doc.chunkCount === 'number' ? doc.chunkCount : 0,
        });
      }
    } finally {
      setLoadingModal(false);
    }
  };

  const saveModal = async () => {
    const t = editTitle.trim();
    const c = editBody.trim();
    if (!t || !c) {
      setWriteErr('Title and text content are required.');
      return;
    }
    setSavingModal(true);
    setWriteErr('');
    try {
      const { document: patched } = await updateKbRichText(token, doc.id, { tenantId: subId, title: t, content: c });
      setSaveOk('Note saved.');
      onPatchedDocument?.(patched);
      setEditorFacts({ updatedAt: patched.updatedAt, chunkCount: patched.chunkCount });
      setModalOpen(false);
    } catch (er) {
      const raw = isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Save failed';
      setWriteErr(friendlifyKbMessage(raw));
    } finally {
      setSavingModal(false);
    }
  };

  return (
    <>
      <article style={faqCardShell}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
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
              Title
            </p>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: '#0f172a', lineHeight: 1.4 }}>{doc.title}</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {inVaultView ? (
              <span style={{ fontSize: '0.72rem', fontWeight: 500, color: '#94a3b8' }}>In this vault</span>
            ) : (
              <KbVaultPill name={doc.vaultName?.trim() || 'Unassigned'} />
            )}
            <StatusPill label={faqListStatusLabel(doc.status)} tone={statusPillTone(doc.status)} />
          </div>
        </div>

        <DocumentVaultLine
          doc={doc}
          vaults={vaults}
          token={token}
          subId={subId}
          vaultAssignBusy={vaultAssignBusy}
          onVaultAssignBusy={onVaultAssignBusy}
          onPatchDocVault={onPatchDocVault}
          setSaveOk={setSaveOk}
          setWriteErr={setWriteErr}
          inVaultView={inVaultView}
        />

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
          Preview
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
                    maxHeight: 168,
                    overflowY: 'auto' as const,
                  }
                : {
                    fontSize: '0.875rem',
                    color: '#475569',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap' as const,
                    display: '-webkit-box',
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden',
                  }
            }
          >
            {preview}
          </div>
        ) : (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No preview yet — use View / Edit to add text.</p>
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

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '12px 16px',
            marginTop: '1.1rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid rgba(241, 245, 249, 0.95)',
          }}
        >
          <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', color: '#94a3b8' }}>
            {fmtKind(doc.documentKind ?? 'rich_text')} · {typeof doc.chunkCount === 'number' ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}` : '—'}
          </span>
          {typeof doc.chunkCount === 'number' &&
          doc.chunkCount <= 1 &&
          typeof doc.sizeBytes === 'number' &&
          doc.sizeBytes > 600 ? (
            <span
              title="Long note indexed as a single chunk — section detection may have failed. Open and re-save."
              style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: '#b45309',
                background: 'rgba(251, 191, 36, 0.18)',
                border: '1px solid rgba(251, 191, 36, 0.55)',
                borderRadius: 999,
                padding: '0.05rem 0.45rem',
              }}
            >
              CHECK CHUNKING
            </span>
          ) : null}
          <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>·</span>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', color: '#94a3b8' }}>
            Updated {relativeTimeLabel(doc.updatedAt ?? doc.createdAt)}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => void openModal()}
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

      {modalOpen ? (
        <KbModal
          wide
          title="View / edit note"
          onClose={() => {
            if (!savingModal) {
              setModalOpen(false);
              setEditorFacts(null);
            }
          }}
          footer={
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={savingModal}
                onClick={() => setModalOpen(false)}
                style={{ ...mvpSecondaryButtonStyle, borderRadius: 10 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingModal || loadingModal}
                onClick={() => void saveModal()}
                style={{ ...mvpPrimaryButtonStyle, borderRadius: 10 }}
              >
                {savingModal ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <dl
            style={{
              margin: '0 0 1rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '0.65rem',
              fontSize: '0.8125rem',
              color: '#475569',
            }}
          >
            <div>
              <dt style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Status</dt>
              <dd style={{ margin: 0 }}>{faqListStatusLabel(doc.status)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Updated</dt>
              <dd style={{ margin: 0 }}>
                {(editorFacts?.updatedAt || doc.updatedAt)
                  ? new Date(editorFacts?.updatedAt || doc.updatedAt!).toLocaleString()
                  : '—'}{' '}
                ({relativeTimeLabel(editorFacts?.updatedAt || doc.updatedAt || doc.createdAt)})
              </dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Chunks</dt>
              <dd style={{ margin: 0 }}>
                {typeof (editorFacts?.chunkCount ?? doc.chunkCount) === 'number'
                  ? String(editorFacts?.chunkCount ?? doc.chunkCount)
                  : '—'}
              </dd>
            </div>
          </dl>
          <label>
            <span style={mvpLabelStyle}>Title</span>
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%' }}
              disabled={loadingModal}
            />
          </label>
          <label style={{ display: 'block', marginTop: '0.85rem' }}>
            <span style={mvpLabelStyle}>Full content</span>
            <textarea
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              rows={18}
              style={{
                ...mvpInputStyle,
                marginTop: '0.35rem',
                width: '100%',
                minHeight: 280,
                maxHeight: 'min(52vh, 520px)',
                resize: 'vertical' as const,
                overflowY: 'auto' as const,
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                lineHeight: 1.5,
              }}
              disabled={loadingModal}
              spellCheck
            />
          </label>
          {loadingModal ? <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.65rem 0 0' }}>Loading note text…</p> : null}
        </KbModal>
      ) : null}
    </>
  );
}

function FileKnowledgeCard({
  doc,
  token,
  subId,
  deleting,
  onDelete,
  vaults,
  vaultAssignBusy,
  onVaultAssignBusy,
  onPatchDocVault,
  setWriteErr,
  setSaveOk,
  inVaultView = false,
}: {
  doc: KbDocumentRow;
  token: string;
  subId: string;
  deleting: boolean;
  onDelete: () => void;
  vaults: KbVaultRow[];
  vaultAssignBusy: boolean;
  onVaultAssignBusy: (busy: boolean) => void;
  onPatchDocVault: (documentId: string, vaultId: string, vaultName: string | null) => void;
  setWriteErr: (s: string) => void;
  setSaveOk: (s: string) => void;
  inVaultView?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [extractedOpen, setExtractedOpen] = useState(false);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkText, setChunkText] = useState('');
  const [chunkErr, setChunkErr] = useState('');
  const [downloading, setDownloading] = useState(false);

  const preview = (doc.answerPreview ?? '').trim();
  const needsShowMore = preview.length > 220 || preview.split(/\n/).length > 3;
  const canDownload = doc.originalDownloadable === true;

  const loadChunks = async () => {
    setChunkLoading(true);
    setChunkErr('');
    setChunkText('');
    try {
      const chunks = await getKbDocumentChunks(token, subId, doc.id);
      const text = chunks.map((c, i) => `— Section ${i + 1} —\n${c.content}`).join('\n\n');
      setChunkText(text.trim());
    } catch (e) {
      setChunkErr(isApiHttpError(e) ? e.message : 'Could not load extracted text');
    } finally {
      setChunkLoading(false);
    }
  };

  const openExtracted = () => {
    setExtractedOpen(true);
    void loadChunks();
  };

  const onDownload = async () => {
    if (!canDownload) return;
    setDownloading(true);
    setWriteErr('');
    try {
      const { blob, filename } = await downloadKbDocumentOriginal(token, subId, doc.id, doc.title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const raw = isApiHttpError(e) ? e.message : e instanceof Error ? e.message : 'Download failed';
      setWriteErr(friendlifyKbMessage(raw));
    } finally {
      setDownloading(false);
    }
  };

  const mimeLine = doc.mimeType?.trim() || '—';

  return (
    <>
      <article style={faqCardShell}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
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
              File
            </p>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: '#0f172a', lineHeight: 1.4 }}>{doc.title}</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {inVaultView ? (
              <span style={{ fontSize: '0.72rem', fontWeight: 500, color: '#94a3b8' }}>In this vault</span>
            ) : (
              <KbVaultPill name={doc.vaultName?.trim() || 'Unassigned'} />
            )}
            <StatusPill label={faqListStatusLabel(doc.status)} tone={statusPillTone(doc.status)} />
          </div>
        </div>

        <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0.85rem 0 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#475569' }}>{fileKindLabel(doc)}</strong>
          {' · '}
          {mimeLine}
          {' · '}
          {formatFileBytes(doc.sizeBytes)}
        </p>
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.35rem 0 0', lineHeight: 1.45 }}>
          Uploaded {doc.createdAt ? new Date(doc.createdAt).toLocaleString() : '—'}
          {' · '}
          Updated {relativeTimeLabel(doc.updatedAt ?? doc.createdAt)}
          {' · '}
          {typeof doc.chunkCount === 'number' ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}` : '—'}
        </p>

        <DocumentVaultLine
          doc={doc}
          vaults={vaults}
          token={token}
          subId={subId}
          vaultAssignBusy={vaultAssignBusy}
          onVaultAssignBusy={onVaultAssignBusy}
          onPatchDocVault={onPatchDocVault}
          setSaveOk={setSaveOk}
          setWriteErr={setWriteErr}
          inVaultView={inVaultView}
        />

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
          Indexed text preview
        </p>
        {preview ? (
          <>
            <div
              style={
                expanded
                  ? {
                      fontSize: '0.875rem',
                      color: '#475569',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap' as const,
                      maxHeight: 220,
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
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>No preview available.</p>
        )}

        {!canDownload ? (
          <p style={{ fontSize: '0.78rem', color: '#78716c', margin: '0.75rem 0 0', lineHeight: 1.45 }}>
            Original file download unavailable. Parsed text is available.
          </p>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            marginTop: '1.05rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid rgba(241, 245, 249, 0.95)',
          }}
        >
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
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
            View details
          </button>
          <button
            type="button"
            onClick={() => openExtracted()}
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
            View extracted text
          </button>
          <button
            type="button"
            disabled={!canDownload || downloading}
            onClick={() => void onDownload()}
            title={canDownload ? 'Download the original upload' : 'Original bytes were not kept for this file'}
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: canDownload ? PRIMARY : '#94a3b8',
              background: canDownload ? 'rgba(15, 98, 254, 0.08)' : '#f1f5f9',
              border: `1px solid ${canDownload ? 'rgba(15, 98, 254, 0.25)' : '#e2e8f0'}`,
              borderRadius: 10,
              padding: '0.4rem 0.85rem',
              cursor: canDownload && !downloading ? 'pointer' : 'not-allowed',
            }}
          >
            {downloading ? 'Preparing…' : 'Download original'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            style={{
              marginLeft: 'auto',
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
      </article>

      {detailsOpen ? (
        <KbModal title="File details" onClose={() => setDetailsOpen(false)}>
          <dl style={{ margin: 0, display: 'grid', gap: '0.65rem', fontSize: '0.875rem', color: '#334155' }}>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Filename</dt>
              <dd style={{ margin: 0 }}>{doc.title}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Type</dt>
              <dd style={{ margin: 0 }}>{fileKindLabel(doc)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>MIME</dt>
              <dd style={{ margin: 0 }}>{mimeLine}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>
                Knowledge vault
              </dt>
              <dd style={{ margin: 0 }}>{doc.vaultName?.trim() || '—'}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Size</dt>
              <dd style={{ margin: 0 }}>{formatFileBytes(doc.sizeBytes)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Uploaded</dt>
              <dd style={{ margin: 0 }}>{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Status</dt>
              <dd style={{ margin: 0 }}>{faqListStatusLabel(doc.status)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Chunks</dt>
              <dd style={{ margin: 0 }}>{typeof doc.chunkCount === 'number' ? String(doc.chunkCount) : '—'}</dd>
            </div>
          </dl>
        </KbModal>
      ) : null}

      {extractedOpen ? (
        <KbModal title="Extracted text (what the bot reads)" onClose={() => setExtractedOpen(false)}>
          {chunkLoading ? <p style={{ margin: 0, color: '#64748b' }}>Loading…</p> : null}
          {chunkErr ? <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.875rem' }}>{chunkErr}</p> : null}
          {!chunkLoading && !chunkErr ? (
            <pre
              style={{
                margin: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.8125rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#1e293b',
              }}
            >
              {chunkText || 'No text chunks for this document.'}
            </pre>
          ) : null}
        </KbModal>
      ) : null}
    </>
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
  const [vaults, setVaults] = useState<KbVaultRow[]>([]);
  const [newVaultName, setNewVaultName] = useState('');
  const [vaultMutating, setVaultMutating] = useState(false);
  const [vaultAssignBusy, setVaultAssignBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedVaultId, setSelectedVaultId] = useState('');
  const [detailName, setDetailName] = useState('');
  const [detailDesc, setDetailDesc] = useState('');

  const [faqQ, setFaqQ] = useState('');
  const [faqA, setFaqA] = useState('');
  const [richTitle, setRichTitle] = useState('');
  const [richBody, setRichBody] = useState('');

  const [qSearch, setQSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [searchHits, setSearchHits] = useState<KbSearchHit[] | null>(null);
  const [searchTraceHit, setSearchTraceHit] = useState<KbSearchHit | null>(null);
  const [searchTraceLoading, setSearchTraceLoading] = useState(false);
  const [searchTraceErr, setSearchTraceErr] = useState('');
  const [searchTraceView, setSearchTraceView] = useState<KbSearchTraceView | null>(null);

  const load = useCallback(async () => {
    if (!token || !subId) return;
    setLoading(true);
    setLoadErr('');
    try {
      const [d, v] = await Promise.all([
        listKbDocuments(token, subId, { allStatuses: true }),
        listKbVaults(token, subId).catch(() => [] as KbVaultRow[]),
      ]);
      setDocs(d);
      setVaults(Array.isArray(v) ? v : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      setLoadErr(friendlifyKbMessage(msg));
    } finally {
      setLoading(false);
    }
  }, [token, subId, reload]);

  const refreshVaults = useCallback(async () => {
    if (!token || !subId) return;
    try {
      const v = await listKbVaults(token, subId);
      setVaults(Array.isArray(v) ? v : []);
    } catch {
      /* ignore */
    }
  }, [token, subId]);

  const patchDocVault = useCallback(
    (documentId: string, vaultId: string, vaultName: string | null) => {
      setDocs(prev =>
        prev.map(x =>
          x.id === documentId ? { ...x, vaultId, vaultName: vaultName ?? x.vaultName ?? null } : x,
        ),
      );
      void refreshVaults();
    },
    [refreshVaults],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedVaultId(prev => resolveSelectedVaultId(vaults, prev));
  }, [vaults]);

  useEffect(() => {
    const v = vaults.find(x => x.id === selectedVaultId);
    if (!v) {
      setDetailName('');
      setDetailDesc('');
      return;
    }
    setDetailName(v.name);
    setDetailDesc(v.description ?? '');
  }, [selectedVaultId, vaults]);

  const vaultScopeDocs = useMemo(
    () => vaultScopedDocuments(docs, selectedVaultId),
    [docs, selectedVaultId],
  );

  const selectedVault = useMemo(
    () => vaults.find(v => v.id === selectedVaultId) ?? null,
    [vaults, selectedVaultId],
  );

  const { faqRows, richRows, fileRows, otherRows } = useMemo(() => {
    const faq: KbDocumentRow[] = [];
    const file: KbDocumentRow[] = [];
    const rich: KbDocumentRow[] = [];
    const other: KbDocumentRow[] = [];
    for (const d of vaultScopeDocs) {
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
  }, [vaultScopeDocs]);

  const bump = () => setReload(x => x + 1);

  const onFaqSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || !subId) return;
    if (!selectedVaultId) {
      setWriteErr(NO_VAULT_EMPTY_MSG);
      setSaveOk('');
      return;
    }
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
      await createKbFaq(token, {
        tenantId: subId,
        question: q,
        answer: a,
        vaultId: selectedVaultId,
      });
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
    if (!selectedVaultId) {
      setWriteErr(NO_VAULT_EMPTY_MSG);
      setSaveOk('');
      return;
    }
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
      await createKbRichText(token, {
        tenantId: subId,
        title,
        content: body,
        vaultId: selectedVaultId,
      });
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
    if (!selectedVaultId) {
      setWriteErr(NO_VAULT_EMPTY_MSG);
      setSaveOk('');
      return;
    }
    setWriteErr('');
    setSaveOk('');
    setSaving(true);
    try {
      await uploadKbFile(token, subId, file, selectedVaultId);
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
    if (!selectedVaultId) {
      setSearchErr(NO_VAULT_EMPTY_MSG);
      return;
    }
    const form = e.currentTarget;
    const qel = form.elements.namedItem('kb-search-query') as HTMLInputElement | null;
    const q = (qel?.value ?? qSearch).trim();
    if (!q) return;
    setQSearch(q);
    setSearchErr('');
    setSearching(true);
    setSearchHits(null);
    try {
      const r = await searchKb(token, { tenantId: subId, query: q, topK: 12, vaultId: selectedVaultId });
      setSearchHits(Array.isArray(r.hits) ? r.hits : []);
    } catch (er) {
      const raw = er instanceof Error ? er.message : 'Search failed';
      setSearchErr(friendlifyKbMessage(raw));
    } finally {
      setSearching(false);
    }
  };

  const closeSearchTraceModal = () => {
    setSearchTraceHit(null);
    setSearchTraceView(null);
    setSearchTraceErr('');
    setSearchTraceLoading(false);
  };

  const openSearchTraceModal = useCallback(
    async (hit: KbSearchHit) => {
      if (!token) return;
      setSearchTraceHit(hit);
      setSearchTraceErr('');
      setSearchTraceView(null);
      setSearchTraceLoading(true);
      const kind = (hit.kind ?? '').trim().toLowerCase();
      const treatAsFile = kind === 'file' || kind.includes('/');
      const isFaq = kind === 'faq';

      try {
        if (!isFaq && !treatAsFile) {
          try {
            const rich = await getKbRichNoteSource(token, subId, hit.documentId);
            setSearchTraceView({ mode: 'rich', title: rich.title, rich });
            return;
          } catch {
            // Notes that only exist as chunks, or legacy rows — fall through.
          }
        }
        const chunks = await getKbDocumentChunks(token, subId, hit.documentId);
        setSearchTraceView({ mode: 'chunks', title: hit.documentTitle, chunks });
      } catch (e) {
        setSearchTraceErr(e instanceof Error ? e.message : 'Could not load source');
      } finally {
        setSearchTraceLoading(false);
      }
    },
    [token, subId],
  );

  const tabUnderline = (active: boolean): CSSProperties => ({
    fontSize: '0.875rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    padding: '0 2px 14px',
    marginBottom: -1,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: active ? PRIMARY : 'var(--aisbp-muted, #64748b)',
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
          <h1
            style={{
              fontSize: '1.875rem',
              fontWeight: 800,
              margin: 0,
              lineHeight: 1.2,
              color: 'var(--aisbp-text-heading, #0f172a)',
              letterSpacing: '-0.03em',
            }}
          >
            Knowledge
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--aisbp-muted, #64748b)',
              margin: '0.5rem 0 0',
              maxWidth: '36rem',
              lineHeight: 1.55,
            }}
          >
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
                <section style={{ ...glassSection, marginBottom: '1.25rem' }}>
                  <h2
                    style={{
                      fontSize: '1rem',
                      fontWeight: 700,
                      margin: '0 0 0.25rem',
                      color: 'var(--aisbp-text-heading, #0f172a)',
                    }}
                  >
                    Knowledge Vaults
                  </h2>
                  <p
                    style={{
                      fontSize: '0.8125rem',
                      color: 'var(--aisbp-muted, #64748b)',
                      margin: '0 0 1rem',
                      lineHeight: 1.45,
                      maxWidth: '48rem',
                    }}
                  >
                    Each vault is its own container for FAQs, notes, and files. Select a vault to add or edit knowledge
                    here. Which vaults the live bot uses is configured under Bot Instructions → Assistant Profile — not by
                    this selection.
                  </p>
                  {vaults.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
                      {NO_VAULT_EMPTY_MSG}
                    </p>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '1.25rem',
                        alignItems: 'stretch',
                        marginBottom: '1rem',
                      }}
                    >
                      <div
                        style={{
                          flex: '1 1 260px',
                          minWidth: 220,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                        }}
                      >
                        <p
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            letterSpacing: '0.07em',
                            textTransform: 'uppercase' as const,
                            color: '#94a3b8',
                            margin: 0,
                          }}
                        >
                          Vaults
                        </p>
                        {vaults.map(v => (
                          <div
                            key={v.id}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedVaultId(v.id);
                              }
                            }}
                            onClick={() => setSelectedVaultId(v.id)}
                            style={vaultListCardStyle(selectedVaultId === v.id)}
                          >
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#0f172a' }}>{v.name}</span>
                              {v.isDefault ? (
                                <span
                                  style={{
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    letterSpacing: '0.06em',
                                    color: '#64748b',
                                    textTransform: 'uppercase' as const,
                                  }}
                                >
                                  Default
                                </span>
                              ) : null}
                            </div>
                            <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>
                              {v.documentCount} document{v.documentCount === 1 ? '' : 's'}
                              {' · '}
                              Updated {relativeTimeLabel(v.updatedAt)}
                            </div>
                            <div
                              style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedVaultId(v.id);
                                  setSaveOk('');
                                }}
                                style={{ ...mvpSecondaryButtonStyle, padding: '0.28rem 0.55rem', fontSize: '0.78rem' }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={vaultMutating}
                                onClick={() => {
                                  if (!token) return;
                                  void (async () => {
                                    setVaultMutating(true);
                                    setWriteErr('');
                                    try {
                                      const { id } = await duplicateKbVault(token, subId, v.id);
                                      setSelectedVaultId(id);
                                      setSaveOk('Vault duplicated. Knowledge items are not copied yet.');
                                      await load();
                                    } catch (er) {
                                      const raw =
                                        isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Duplicate failed';
                                      setWriteErr(friendlifyKbMessage(raw));
                                    } finally {
                                      setVaultMutating(false);
                                    }
                                  })();
                                }}
                                style={{ ...mvpSecondaryButtonStyle, padding: '0.28rem 0.55rem', fontSize: '0.78rem' }}
                              >
                                Duplicate
                              </button>
                              <button
                                type="button"
                                disabled={vaultMutating || v.isDefault || v.documentCount > 0}
                                title={
                                  v.isDefault
                                    ? 'Cannot delete the default vault.'
                                    : v.documentCount > 0
                                      ? "Move or delete this vault's knowledge items before deleting the vault."
                                      : undefined
                                }
                                onClick={() => {
                                  if (!token || v.isDefault || v.documentCount > 0) return;
                                  if (!window.confirm(`Delete vault “${v.name}”?`)) return;
                                  void (async () => {
                                    setVaultMutating(true);
                                    setWriteErr('');
                                    try {
                                      await deleteKbVault(token, v.id, subId);
                                      setSaveOk('Vault deleted.');
                                      await load();
                                    } catch (er) {
                                      const raw =
                                        isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Delete failed';
                                      setWriteErr(friendlifyKbMessage(raw));
                                    } finally {
                                      setVaultMutating(false);
                                    }
                                  })();
                                }}
                                style={{
                                  ...mvpSecondaryButtonStyle,
                                  padding: '0.28rem 0.55rem',
                                  fontSize: '0.78rem',
                                  color: v.isDefault || v.documentCount > 0 ? '#cbd5e1' : '#b91c1c',
                                  borderColor:
                                    v.isDefault || v.documentCount > 0 ? 'rgba(148, 163, 184, 0.35)' : 'rgba(185, 28, 28, 0.35)',
                                  cursor: v.isDefault || v.documentCount > 0 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                        {selectedVault ? (
                          <div
                            style={{
                              borderRadius: 12,
                              padding: '1rem 1.1rem',
                              background: 'rgba(248, 250, 252, 0.95)',
                              border: '1px solid rgba(226, 232, 240, 0.9)',
                            }}
                          >
                            <p
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                letterSpacing: '0.07em',
                                textTransform: 'uppercase' as const,
                                color: '#94a3b8',
                                margin: '0 0 0.5rem',
                              }}
                            >
                              Selected vault
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem' }}>
                              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                                {selectedVault.name}
                              </h3>
                              {selectedVault.isDefault ? (
                                <span
                                  style={{
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    letterSpacing: '0.06em',
                                    color: '#64748b',
                                    textTransform: 'uppercase' as const,
                                  }}
                                >
                                  Default
                                </span>
                              ) : null}
                            </div>
                            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.85rem', lineHeight: 1.45 }}>
                              {selectedVault.documentCount} document{selectedVault.documentCount === 1 ? '' : 's'}
                              {' · '}Updated {relativeTimeLabel(selectedVault.updatedAt)}
                            </p>
                            <label>
                              <span style={mvpLabelStyle}>Vault name</span>
                              <input
                                value={detailName}
                                onChange={e => {
                                  setDetailName(e.target.value);
                                  setSaveOk('');
                                }}
                                style={{ ...mvpInputStyle, marginTop: '0.35rem', width: '100%', maxWidth: 400 }}
                                autoComplete="off"
                              />
                            </label>
                            <label style={{ display: 'block', marginTop: '0.75rem' }}>
                              <span style={mvpLabelStyle}>Description</span>
                              <textarea
                                value={detailDesc}
                                onChange={e => {
                                  setDetailDesc(e.target.value);
                                  setSaveOk('');
                                }}
                                rows={3}
                                placeholder="Optional — shown here for your team"
                                style={{
                                  ...mvpInputStyle,
                                  marginTop: '0.35rem',
                                  width: '100%',
                                  maxWidth: 480,
                                  minHeight: 72,
                                  resize: 'vertical' as const,
                                }}
                              />
                            </label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
                              <button
                                type="button"
                                disabled={vaultMutating || !detailName.trim()}
                                onClick={() => {
                                  if (!token || !selectedVaultId) return;
                                  void (async () => {
                                    setVaultMutating(true);
                                    setWriteErr('');
                                    try {
                                      await updateKbVault(token, selectedVaultId, subId, {
                                        name: detailName.trim(),
                                        description: detailDesc.trim() || null,
                                      });
                                      setSaveOk('Vault saved.');
                                      await load();
                                    } catch (er) {
                                      const raw =
                                        isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Save failed';
                                      setWriteErr(friendlifyKbMessage(raw));
                                    } finally {
                                      setVaultMutating(false);
                                    }
                                  })();
                                }}
                                style={mvpPrimaryButtonStyle}
                              >
                                {vaultMutating ? 'Saving…' : 'Save changes'}
                              </button>
                              <button
                                type="button"
                                disabled={vaultMutating}
                                onClick={() => {
                                  if (!token) return;
                                  void (async () => {
                                    setVaultMutating(true);
                                    setWriteErr('');
                                    try {
                                      const { id } = await duplicateKbVault(token, subId, selectedVaultId);
                                      setSelectedVaultId(id);
                                      setSaveOk('Vault duplicated. Knowledge items are not copied yet.');
                                      await load();
                                    } catch (er) {
                                      const raw =
                                        isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Duplicate failed';
                                      setWriteErr(friendlifyKbMessage(raw));
                                    } finally {
                                      setVaultMutating(false);
                                    }
                                  })();
                                }}
                                style={mvpSecondaryButtonStyle}
                              >
                                Duplicate vault
                              </button>
                              <button
                                type="button"
                                disabled={
                                  vaultMutating || selectedVault.isDefault || selectedVault.documentCount > 0
                                }
                                title={
                                  selectedVault.isDefault
                                    ? 'Cannot delete the default vault.'
                                    : selectedVault.documentCount > 0
                                      ? "Move or delete this vault's knowledge items before deleting the vault."
                                      : undefined
                                }
                                onClick={() => {
                                  if (!token || selectedVault.isDefault || selectedVault.documentCount > 0) return;
                                  if (!window.confirm(`Delete vault “${selectedVault.name}”?`)) return;
                                  void (async () => {
                                    setVaultMutating(true);
                                    setWriteErr('');
                                    try {
                                      await deleteKbVault(token, selectedVaultId, subId);
                                      setSaveOk('Vault deleted.');
                                      await load();
                                    } catch (er) {
                                      const raw =
                                        isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Delete failed';
                                      setWriteErr(friendlifyKbMessage(raw));
                                    } finally {
                                      setVaultMutating(false);
                                    }
                                  })();
                                }}
                                style={{
                                  ...mvpSecondaryButtonStyle,
                                  color:
                                    selectedVault.isDefault || selectedVault.documentCount > 0 ? '#cbd5e1' : '#b91c1c',
                                  borderColor:
                                    selectedVault.isDefault || selectedVault.documentCount > 0
                                      ? 'rgba(148, 163, 184, 0.35)'
                                      : 'rgba(185, 28, 28, 0.35)',
                                  cursor:
                                    selectedVault.isDefault || selectedVault.documentCount > 0
                                      ? 'not-allowed'
                                      : 'pointer',
                                }}
                              >
                                Delete vault
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>
                            Select a vault from the list.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  <form
                    style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}
                    onSubmit={e => {
                      e.preventDefault();
                      if (!token) return;
                      const n = newVaultName.trim();
                      if (!n) return;
                      void (async () => {
                        setVaultMutating(true);
                        setWriteErr('');
                        try {
                          await createKbVault(token, { tenantId: subId, name: n });
                          setNewVaultName('');
                          setSaveOk('Vault created.');
                          await load();
                        } catch (er) {
                          const raw =
                            isApiHttpError(er) ? er.message : er instanceof Error ? er.message : 'Could not create vault';
                          setWriteErr(friendlifyKbMessage(raw));
                        } finally {
                          setVaultMutating(false);
                        }
                      })();
                    }}
                  >
                    <input
                      value={newVaultName}
                      onChange={e => {
                        setNewVaultName(e.target.value);
                        setSaveOk('');
                      }}
                      placeholder="New vault name"
                      style={{ ...mvpInputStyle, flex: '1 1 200px', maxWidth: 280 }}
                      autoComplete="off"
                    />
                    <button type="submit" disabled={vaultMutating} style={mvpPrimaryButtonStyle}>
                      {vaultMutating ? 'Creating…' : 'Create vault'}
                    </button>
                  </form>
                </section>

                <h2
                  style={{
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    margin: '0 0 0.15rem',
                    color: 'var(--aisbp-text-heading, #0f172a)',
                  }}
                >
                  Add knowledge to this vault
                </h2>
                {selectedVault ? (
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 0.65rem', lineHeight: 1.45 }}>
                    <strong style={{ fontWeight: 600, color: '#475569' }}>{selectedVault.name}</strong>
                  </p>
                ) : (
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 0.65rem', lineHeight: 1.45 }}>
                    {NO_VAULT_EMPTY_MSG}
                  </p>
                )}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '0.75rem',
                    marginBottom: '1.35rem',
                  }}
                  aria-label="Add knowledge"
                >
                  <button
                    type="button"
                    style={{
                      ...bentoBtn,
                      ...(!selectedVaultId ? { opacity: 0.55, cursor: 'not-allowed' as const } : {}),
                    }}
                    onClick={() => {
                      if (!selectedVaultId) {
                        setWriteErr(NO_VAULT_EMPTY_MSG);
                        setSaveOk('');
                        return;
                      }
                      setTab('rich');
                      setSaveOk('');
                    }}
                  >
                    <span style={iconCircle}>📝</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Add note</span>
                  </button>
                  <button
                    type="button"
                    style={{
                      ...bentoBtn,
                      ...(!selectedVaultId ? { opacity: 0.55, cursor: 'not-allowed' as const } : {}),
                    }}
                    onClick={() => {
                      if (!selectedVaultId) {
                        setWriteErr(NO_VAULT_EMPTY_MSG);
                        setSaveOk('');
                        return;
                      }
                      setTab('files');
                      fileInputRef.current?.click();
                    }}
                  >
                    <span style={iconCircle}>📤</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Upload file</span>
                  </button>
                  <button
                    type="button"
                    style={{
                      ...bentoBtn,
                      ...(!selectedVaultId ? { opacity: 0.55, cursor: 'not-allowed' as const } : {}),
                    }}
                    onClick={() => {
                      if (!selectedVaultId) {
                        setWriteErr(NO_VAULT_EMPTY_MSG);
                        setSaveOk('');
                        return;
                      }
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
                  <p style={{ fontSize: '0.75rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1rem' }}>Working…</p>
                ) : null}

                <p
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase' as const,
                    color: '#94a3b8',
                    margin: '0 0 0.45rem',
                  }}
                >
                  Vault content
                </p>
                <div
                  style={{
                    display: 'flex',
                    gap: '1.5rem',
                    borderBottom: '1px solid var(--aisbp-border, #e2e8f0)',
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
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.2rem', color: 'var(--aisbp-text-heading, #0f172a)' }}>
                      Approved FAQ
                    </h2>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1rem', lineHeight: 1.45 }}>
                      Add approved answers your bot can use when replying.
                    </p>
                    <form onSubmit={onFaqSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 520, marginBottom: '1.25rem' }}>
                      {selectedVault ? (
                        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>
                          This FAQ will be saved to <strong style={{ fontWeight: 600, color: '#334155' }}>{selectedVault.name}</strong>.
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>{NO_VAULT_EMPTY_MSG}</p>
                      )}
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
                      <button
                        type="submit"
                        disabled={saving || !selectedVaultId}
                        style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}
                      >
                        {saving ? 'Saving…' : 'Save FAQ'}
                      </button>
                    </form>

                    {faqRows.length === 0 ? (
                      <EmptyState
                        compact
                        title="No FAQs in this vault yet."
                        detail="Add an FAQ below. It will be stored only in this vault until you move it."
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
                            vaults={vaults}
                            vaultAssignBusy={vaultAssignBusy}
                            onVaultAssignBusy={setVaultAssignBusy}
                            onPatchDocVault={patchDocVault}
                            setWriteErr={setWriteErr}
                            setSaveOk={setSaveOk}
                            inVaultView
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
                      {selectedVault ? (
                        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>
                          This note will be saved to <strong style={{ fontWeight: 600, color: '#334155' }}>{selectedVault.name}</strong>.
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>{NO_VAULT_EMPTY_MSG}</p>
                      )}
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
                      <button
                        type="submit"
                        disabled={saving || !selectedVaultId}
                        style={{ ...mvpPrimaryButtonStyle, width: 'fit-content' }}
                      >
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
                      <EmptyState
                        compact
                        title="No notes in this vault yet."
                        detail="Add a note below. It stays in this vault until you move it elsewhere."
                      />
                    ) : (
                      <div>
                        {richRows.map(d => (
                          <NoteKnowledgeCard
                            key={d.id}
                            doc={d}
                            token={token!}
                            subId={subId}
                            deleting={deletingId === d.id}
                            onDelete={() => onDelete(d.id)}
                            onPatchedDocument={patch => {
                              setDocs(prev =>
                                prev.map(x =>
                                  x.id === patch.id
                                    ? {
                                        ...x,
                                        title: patch.title,
                                        status: patch.status,
                                        updatedAt: patch.updatedAt?.trim() ? patch.updatedAt : new Date().toISOString(),
                                        chunkCount: patch.chunkCount,
                                        answerPreview: patch.answerPreview,
                                      }
                                    : x,
                                ),
                              );
                            }}
                            vaults={vaults}
                            vaultAssignBusy={vaultAssignBusy}
                            onVaultAssignBusy={setVaultAssignBusy}
                            onPatchDocVault={patchDocVault}
                            setWriteErr={setWriteErr}
                            setSaveOk={setSaveOk}
                            inVaultView
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
                      Plain text (.txt) is indexed right away. Use <strong style={{ fontWeight: 600 }}>View extracted text</strong> on each
                      card to confirm what the bot can read. Original download appears only when the server keeps the uploaded file.
                    </p>
                    {selectedVault ? (
                      <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45, maxWidth: 520 }}>
                        Files will be uploaded to <strong style={{ fontWeight: 600, color: '#334155' }}>{selectedVault.name}</strong>.
                      </p>
                    ) : (
                      <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45 }}>{NO_VAULT_EMPTY_MSG}</p>
                    )}
                    <div
                      role="button"
                      tabIndex={!selectedVaultId ? -1 : 0}
                      onKeyDown={e => {
                        if (!selectedVaultId) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          fileInputRef.current?.click();
                        }
                      }}
                      onClick={() => {
                        if (!selectedVaultId) {
                          setWriteErr(NO_VAULT_EMPTY_MSG);
                          setSaveOk('');
                          return;
                        }
                        fileInputRef.current?.click();
                      }}
                      style={{
                        display: 'block',
                        fontSize: '0.8125rem',
                        padding: '1rem 1.1rem',
                        borderRadius: 12,
                        border: '1px dashed #94a3b8',
                        background: 'rgba(248, 250, 252, 0.8)',
                        color: '#334155',
                        cursor: !selectedVaultId ? 'not-allowed' : 'pointer',
                        textAlign: 'center',
                        marginBottom: '1rem',
                        opacity: !selectedVaultId ? 0.55 : 1,
                      }}
                    >
                      Choose a file to upload (PDF, DOC, DOCX, or TXT)
                    </div>
                    {fileRows.length === 0 ? (
                      <EmptyState
                        compact
                        title="No files in this vault yet."
                        detail="Upload a file below. It is stored only in this vault until you move it."
                      />
                    ) : (
                      <div>
                        {fileRows.map(d => (
                          <FileKnowledgeCard
                            key={d.id}
                            doc={d}
                            token={token!}
                            subId={subId}
                            deleting={deletingId === d.id}
                            onDelete={() => onDelete(d.id)}
                            vaults={vaults}
                            vaultAssignBusy={vaultAssignBusy}
                            onVaultAssignBusy={setVaultAssignBusy}
                            onPatchDocVault={patchDocVault}
                            setWriteErr={setWriteErr}
                            setSaveOk={setSaveOk}
                            inVaultView
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}

                <section style={glassSection}>
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.2rem', color: 'var(--aisbp-text-heading, #0f172a)' }}>
                    Search this vault
                  </h2>
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 0.85rem', lineHeight: 1.45 }}>
                    Keyword search runs only inside{' '}
                    <strong style={{ fontWeight: 600, color: '#475569' }}>{selectedVault?.name ?? 'the selected vault'}</strong>
                    . It does not search other vaults from this page.
                  </p>
                  <form onSubmit={onSearch} style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      name="kb-search-query"
                      value={qSearch}
                      onChange={e => setQSearch(e.target.value)}
                      placeholder={knowledgeSearchPlaceholder(selectedVault?.name ?? '')}
                      disabled={!selectedVaultId}
                      autoComplete="off"
                      style={{
                        ...mvpInputStyle,
                        flex: 1,
                        minWidth: 200,
                        borderRadius: 999,
                        background: '#f1f5f9',
                        border: '1px solid transparent',
                        opacity: !selectedVaultId ? 0.55 : 1,
                      }}
                    />
                    <button
                      type="submit"
                      disabled={searching || !selectedVaultId}
                      style={{ ...mvpPrimaryButtonStyle, borderRadius: 10 }}
                    >
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                  </form>
                  {searchErr ? <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.65rem' }}>{searchErr}</p> : null}
                  {searchHits && (
                    <div style={{ margin: '0.85rem 0 0' }}>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                        {searchHits.length === 0 ? (
                          <li style={{ fontSize: '0.875rem', color: '#64748b' }}>No matching knowledge found</li>
                        ) : (
                          searchHits.slice(0, 8).map(h => (
                            <li
                              key={h.chunkId}
                              style={{
                                marginBottom: '0.9rem',
                                padding: '0.85rem 1rem',
                                borderRadius: 12,
                                border: '1px solid var(--aisbp-border, #e2e8f0)',
                                background: 'var(--aisbp-stat-tile-bg, rgba(248, 250, 252, 0.95))',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  color: '#94a3b8',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.06em',
                                }}
                              >
                                Section
                              </div>
                              <div style={{ fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)', marginTop: 2, fontSize: '0.95rem' }}>
                                {h.sectionTitle ?? '(intro)'}
                              </div>
                              <div
                                style={{
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  color: '#94a3b8',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.06em',
                                  marginTop: '0.65rem',
                                }}
                              >
                                Snippet
                              </div>
                              <div
                                style={{
                                  marginTop: 4,
                                  whiteSpace: 'pre-wrap',
                                  lineHeight: 1.5,
                                  fontSize: '0.8125rem',
                                  color: 'var(--aisbp-text-secondary, #334155)',
                                  maxHeight: '6.2em',
                                  overflow: 'hidden',
                                }}
                              >
                                {stripModelThinking(h.snippet)}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--aisbp-text-secondary, #475569)', marginTop: '0.65rem' }}>
                                Relevance:{' '}
                                <span style={{ fontWeight: 600 }}>{kbSearchRelevanceLabelDisplay(h)}</span>
                                {typeof h.scorePercent === 'number' ? (
                                  <span style={{ color: '#94a3b8', marginLeft: 8 }}>({h.scorePercent}%)</span>
                                ) : null}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.55rem' }}>
                                <button
                                  type="button"
                                  onClick={() => void openSearchTraceModal(h)}
                                  style={{
                                    ...mvpSecondaryButtonStyle,
                                    fontSize: '0.8125rem',
                                    padding: '0.35rem 0.75rem',
                                    borderRadius: 8,
                                  }}
                                >
                                  View full source
                                </button>
                                <span style={{ fontSize: '0.68rem', color: 'var(--aisbp-muted, #94a3b8)' }}>
                                  {kbSearchHitKindLabel(h.kind)} · {h.documentTitle}
                                </span>
                              </div>
                              <div
                                style={{ fontSize: '0.65rem', color: 'var(--aisbp-muted, #cbd5e1)', marginTop: 6 }}
                                title="Chunk id (support)"
                              >
                                Chunk {h.chunkId.slice(0, 8)}…
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                      {searchHits.length > 8 ? (
                        <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0.45rem 0 0' }}>
                          Showing top 8 of {searchHits.length} matches — refine your search to narrow results.
                        </p>
                      ) : null}
                    </div>
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

      {searchTraceHit ? (
        <KbModal
          wide
          title={searchTraceHit.documentTitle}
          onClose={closeSearchTraceModal}
          footer={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setTab(kbSearchHitTargetTab(searchTraceHit));
                  closeSearchTraceModal();
                }}
                style={mvpSecondaryButtonStyle}
              >
                {kbSearchHitTargetTab(searchTraceHit) === 'faq'
                  ? 'Open FAQs tab'
                  : kbSearchHitTargetTab(searchTraceHit) === 'files'
                    ? 'Open Files tab'
                    : 'Open Notes tab'}
              </button>
              <button type="button" onClick={closeSearchTraceModal} style={mvpPrimaryButtonStyle}>
                Close
              </button>
            </div>
          }
        >
          <dl
            style={{
              margin: '0 0 1rem',
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '0.35rem 0.85rem',
              fontSize: '0.8125rem',
              color: 'var(--aisbp-text-secondary, #334155)',
            }}
          >
            <dt style={{ color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 600 }}>Type</dt>
            <dd style={{ margin: 0 }}>{kbSearchHitKindLabel(searchTraceHit.kind)}</dd>
            <dt style={{ color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 600 }}>Section</dt>
            <dd style={{ margin: 0 }}>{searchTraceHit.sectionTitle?.trim() ? searchTraceHit.sectionTitle : '(intro)'}</dd>
            <dt style={{ color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 600 }}>Matched chunk</dt>
            <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>
              {searchTraceHit.chunkId}
            </dd>
            <dt style={{ color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 600 }}>Document id</dt>
            <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>
              {searchTraceHit.documentId}
            </dd>
            {searchTraceHit.updatedAt ? (
              <>
                <dt style={{ color: 'var(--aisbp-muted, #94a3b8)', fontWeight: 600 }}>Last updated</dt>
                <dd style={{ margin: 0 }}>{relativeTimeLabel(searchTraceHit.updatedAt)}</dd>
              </>
            ) : null}
          </dl>

          {searchTraceLoading ? <LoadingBlock message="Loading source…" /> : null}
          {searchTraceErr ? <ErrorBanner message={searchTraceErr} /> : null}

          {!searchTraceLoading && !searchTraceErr && searchTraceView?.mode === 'rich' ? (
            <div>
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.5rem', lineHeight: 1.45 }}>
                Full note text stored for this workspace (same as the Notes editor).
              </p>
              <pre
                style={{
                  margin: 0,
                  padding: '0.75rem 0.85rem',
                  borderRadius: 10,
                  border: '1px solid var(--aisbp-border, #e2e8f0)',
                  background: 'var(--aisbp-stat-tile-bg, #f8fafc)',
                  fontFamily: 'inherit',
                  fontSize: '0.875rem',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--aisbp-text, #1e293b)',
                  maxHeight: 'min(58vh, 560px)',
                  overflow: 'auto',
                }}
              >
                {stripModelThinking(searchTraceView.rich.content)}
              </pre>
            </div>
          ) : null}

          {!searchTraceLoading && !searchTraceErr && searchTraceView?.mode === 'chunks' ? (
            <div>
              <p style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 0.65rem', lineHeight: 1.45 }}>
                All indexed chunks for this document. The chunk from your search is highlighted.
              </p>
              {searchTraceView.chunks.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--aisbp-muted, #64748b)' }}>No chunks on file.</p>
              ) : (
                searchTraceView.chunks.map((ch, idx) => {
                  const isMatch = ch.id === searchTraceHit.chunkId;
                  const meta =
                    ch.metadata && typeof ch.metadata === 'object' && !Array.isArray(ch.metadata)
                      ? (ch.metadata as Record<string, unknown>)
                      : {};
                  const sec = typeof meta['sectionTitle'] === 'string' && meta['sectionTitle'].trim() ? meta['sectionTitle'] : null;
                  return (
                    <div
                      key={ch.id}
                      style={{
                        marginBottom: '0.85rem',
                        padding: '0.75rem 0.85rem',
                        borderRadius: 10,
                        border: isMatch ? `2px solid ${PRIMARY}` : '1px solid var(--aisbp-border, #e2e8f0)',
                        background: isMatch ? 'rgba(15, 98, 254, 0.06)' : 'var(--aisbp-surface, #fafafa)',
                      }}
                    >
                      {isMatch ? (
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: PRIMARY, marginBottom: 6 }}>Search matched this chunk</div>
                      ) : null}
                      <div style={{ fontSize: '0.68rem', color: 'var(--aisbp-muted, #94a3b8)', marginBottom: 4 }}>
                        Part {idx + 1} · <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ch.id}</span>
                        {typeof ch.tokenCount === 'number' ? ` · ~${ch.tokenCount} tokens` : null}
                      </div>
                      {sec ? (
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--aisbp-text-heading, #0f172a)', marginBottom: 6 }}>
                          {sec}
                        </div>
                      ) : null}
                      <pre
                        style={{
                          margin: 0,
                          fontFamily: 'inherit',
                          fontSize: '0.84rem',
                          lineHeight: 1.55,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: 'var(--aisbp-text-secondary, #334155)',
                        }}
                      >
                        {stripModelThinking(ch.content)}
                      </pre>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </KbModal>
      ) : null}
    </div>
  );
}
