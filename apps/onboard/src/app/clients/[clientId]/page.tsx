'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { OnboardChrome } from '@/components/OnboardChrome';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { StatusPill } from '@/components/StatusPill';
import { IdentifierLabel } from '@/components/IdentifierLabel';
import { SafetyBanner } from '@/components/SafetyBanner';
import { useAuth } from '@/contexts/AuthContext';
import type { OnboardClient, OnboardProject, UpdateClientInput, ApprovalEvent, ProjectAnalysis, AutomationRecommendation } from '@/types/onboard';
import { SECTION_LABELS } from '@/types/onboard';
import { formatShortId } from '@/lib/identifiers';

const ALL_SECTIONS = ['business_profile', 'sales_process', 'faq', 'prompt', 'handover', 'follow_up'];

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const { api } = useAuth();
  const clientId = params.clientId;

  const [client, setClient] = useState<OnboardClient | null>(null);
  const [projects, setProjects] = useState<OnboardProject[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateClientInput>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Project creation
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  // Selected project for review
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sectionStatuses, setSectionStatuses] = useState<Record<string, string>>({});
  const [approvalEvents, setApprovalEvents] = useState<ApprovalEvent[]>([]);

  // Approval actions
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvingSection, setApprovingSection] = useState<string | null>(null);
  const [changesComment, setChangesComment] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [approving, setApproving] = useState(false);

  // Analysis & Recommendations
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [recommendations, setRecommendations] = useState<AutomationRecommendation[]>([]);

  const fetchData = useCallback(() => {
    if (!api) return;
    setLoading(true);
    Promise.all([
      api.getClient(clientId),
      api.listProjects().then(ps => ps.filter(p => p.onboardClientId === clientId)),
    ])
      .then(([c, p]) => { setClient(c); setProjects(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchApprovalData = useCallback((projectId: string) => {
    if (!api) return;
    api.getApprovalEvents(projectId).then(setApprovalEvents).catch(() => {});
    api.getProjectAnalysis(projectId).then(setAnalysis).catch(() => {});
    api.getProjectRecommendations(projectId).then(setRecommendations).catch(() => {});
    // Fetch section statuses
    setSectionStatuses(Object.fromEntries(ALL_SECTIONS.map(s => [s, 'EMPTY'])));
  }, [api]);

  useEffect(() => {
    if (selectedProjectId) fetchApprovalData(selectedProjectId);
  }, [selectedProjectId, fetchApprovalData]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  // Edit handlers
  const handleEdit = () => {
    if (!client) return;
    setEditForm({
      displayName: client.displayName,
      contactName: client.contactName || undefined,
      contactPhone: client.contactPhone || undefined,
      contactEmail: client.contactEmail || undefined,
      industry: client.industry || undefined,
      websiteUrl: client.websiteUrl || undefined,
    });
    setEditing(true);
    setEditError(null);
  };

  const handleSave = async () => {
    if (!api || !client) return;
    setSaving(true); setEditError(null);
    try {
      const updated = await api.updateClient(client.id, editForm);
      setClient(updated); setEditing(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleCreateProject = async () => {
    if (!api || !client) return;
    setCreatingProject(true); setCreateProjectError(null);
    try {
      const project = await api.createProject({ onboardClientId: client.id });
      setProjects(prev => [...prev, project]);
      setSelectedProjectId(project.id);
      setShowCreateProject(false);
    } catch (err: unknown) {
      setCreateProjectError(err instanceof Error ? err.message : 'Failed');
    } finally { setCreatingProject(false); }
  };

  // Approval handlers
  const handleApproveSection = async (sectionName: string) => {
    if (!api || !selectedProjectId) return;
    setApprovingSection(sectionName); setApprovalError(null);
    try {
      await api.approveSection(selectedProjectId, sectionName);
      setSectionStatuses(prev => ({ ...prev, [sectionName]: 'APPROVED' }));
      if (selectedProjectId) fetchApprovalData(selectedProjectId);
    } catch (err: unknown) {
      setApprovalError(err instanceof Error ? err.message : 'Approve failed');
    } finally { setApprovingSection(null); }
  };

  const handleRequestChanges = async () => {
    if (!api || !selectedProjectId) return;
    setApproving(true); setApprovalError(null);
    try {
      await api.requestChanges(selectedProjectId, changesComment, []);
      setShowRequestChanges(false);
      setChangesComment('');
      if (selectedProjectId) fetchApprovalData(selectedProjectId);
      // Refresh projects
      api.listProjects().then(ps => setProjects(ps.filter(p => p.onboardClientId === clientId))).catch(() => {});
    } catch (err: unknown) {
      setApprovalError(err instanceof Error ? err.message : 'Failed');
    } finally { setApproving(false); }
  };

  const handleReject = async () => {
    if (!api || !selectedProjectId) return;
    setApproving(true); setApprovalError(null);
    try {
      await api.rejectProject(selectedProjectId, rejectComment);
      setShowReject(false); setRejectComment('');
      if (selectedProjectId) fetchApprovalData(selectedProjectId);
      api.listProjects().then(ps => setProjects(ps.filter(p => p.onboardClientId === clientId))).catch(() => {});
    } catch (err: unknown) {
      setApprovalError(err instanceof Error ? err.message : 'Failed');
    } finally { setApproving(false); }
  };

  const handleApproveProject = async () => {
    if (!api || !selectedProjectId) return;
    setApproving(true); setApprovalError(null);
    try {
      await api.approveProject(selectedProjectId);
      if (selectedProjectId) fetchApprovalData(selectedProjectId);
      api.listProjects().then(ps => setProjects(ps.filter(p => p.onboardClientId === clientId))).catch(() => {});
    } catch (err: unknown) {
      setApprovalError(err instanceof Error ? err.message : 'Approve failed');
    } finally { setApproving(false); }
  };

  if (loading) return <OnboardChrome><p style={{ color: 'var(--aisbp-muted, #64748b)' }}>Loading...</p></OnboardChrome>;
  if (!client) return <OnboardChrome><h1>Client not found</h1></OnboardChrome>;

  return (
    <OnboardChrome>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>
              <IdentifierLabel businessName={client.displayName} clientKey={client.clientKey} />
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <StatusPill status={client.status} />
              <span style={{ fontSize: '0.82rem', color: 'var(--aisbp-muted, #64748b)' }}>
                ID: {formatShortId(client.id)} · {client.industry || '--'}
              </span>
            </div>
          </div>
          {!editing && (
            <button type="button" onClick={handleEdit} style={secondaryBtnStyle()}>Edit</button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <PlaceholderCard title="Edit Client">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <DetailField label="Business Name" value={editForm.displayName || ''} onChange={v => setEditForm(s => ({ ...s, displayName: v }))} />
            <DetailField label="Contact Name" value={editForm.contactName || ''} onChange={v => setEditForm(s => ({ ...s, contactName: v || undefined }))} />
            <DetailField label="Contact Phone" value={editForm.contactPhone || ''} onChange={v => setEditForm(s => ({ ...s, contactPhone: v || undefined }))} />
            <DetailField label="Contact Email" value={editForm.contactEmail || ''} onChange={v => setEditForm(s => ({ ...s, contactEmail: v || undefined }))} />
            <DetailField label="Industry" value={editForm.industry || ''} onChange={v => setEditForm(s => ({ ...s, industry: v || undefined }))} />
            <DetailField label="Website" value={editForm.websiteUrl || ''} onChange={v => setEditForm(s => ({ ...s, websiteUrl: v || undefined }))} />
          </div>
          {editError && <div style={errorBoxStyle}>{editError}</div>}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" onClick={handleSave} disabled={saving} style={primaryBtnStyle(saving)}>{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} style={secondaryBtnStyle()}>Cancel</button>
          </div>
        </PlaceholderCard>
      )}

      {/* Client info */}
      <PlaceholderCard title="Client Details">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.88rem' }}>
          <DetailRow label="Business Name" value={client.displayName} />
          <DetailRow label="Client Key" value={client.clientKey} />
          <DetailRow label="Contact Phone" value={client.contactPhoneMasked || '--'} />
          <DetailRow label="Contact Email" value={client.contactEmail || '--'} />
          <DetailRow label="Industry" value={client.industry || '--'} />
          <DetailRow label="Status" value={client.status} />
        </div>
      </PlaceholderCard>

      {/* Projects */}
      <PlaceholderCard title="Projects">
        {projects.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {projects.map(project => (
              <div
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.85rem',
                  borderRadius: 10, border: selectedProjectId === project.id ? '2px solid #2563EB' : '1px solid var(--aisbp-border, #e2e8f0)',
                  background: 'var(--aisbp-surface, #fff)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--aisbp-text, #0f172a)' }}>
                  Project {formatShortId(project.id)}
                </span>
                <StatusPill status={project.status} />
                <span style={{ fontSize: '0.78rem', color: 'var(--aisbp-muted, #64748b)' }}>
                  Phase: {project.currentPhase}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: '0 0 1rem' }}>No projects yet.</p>
        )}
        {!showCreateProject ? (
          <button type="button" onClick={() => setShowCreateProject(true)} style={primaryBtnStyle(false)}>+ Create Project</button>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="button" onClick={handleCreateProject} disabled={creatingProject} style={primaryBtnStyle(creatingProject)}>{creatingProject ? 'Creating...' : 'Confirm'}</button>
            <button type="button" onClick={() => setShowCreateProject(false)} style={secondaryBtnStyle()}>Cancel</button>
          </div>
        )}
        {createProjectError && <div style={{ ...errorBoxStyle, marginTop: '0.75rem' }}>{createProjectError}</div>}
      </PlaceholderCard>

      {/* Review / Approval panel */}
      {selectedProject && (
        <PlaceholderCard title={`Review: Project ${formatShortId(selectedProject.id)}`}>
          <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', background: '#FEF3C7', borderRadius: 8, fontSize: '0.8rem', color: '#92400E' }}>
            Approval only prepares this project for future dry-run. No KB/GHL sync is active in PR 6.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <StatusPill status={selectedProject.status} />
            <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)' }}>
              Phase: {selectedProject.currentPhase} · v{selectedProject.version}
            </span>
          </div>

          {/* Section review */}
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem', color: 'var(--aisbp-text, #0f172a)' }}>Sections</h3>
          {ALL_SECTIONS.map(sectionName => {
            const status = sectionStatuses[sectionName] || 'EMPTY';
            const canApprove = status === 'COMPLETE' && selectedProject.status !== 'APPROVED' && selectedProject.status !== 'REJECTED';
            return (
              <div key={sectionName} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: 160, color: 'var(--aisbp-text, #0f172a)' }}>
                  {SECTION_LABELS[sectionName] || sectionName}
                </span>
                <StatusPill status={status} />
                {canApprove && (
                  <button
                    type="button"
                    onClick={() => handleApproveSection(sectionName)}
                    disabled={approvingSection === sectionName}
                    style={{ ...primaryBtnStyle(approvingSection === sectionName), padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}
                  >
                    {approvingSection === sectionName ? '...' : 'Approve'}
                  </button>
                )}
              </div>
            );
          })}

          {approvalError && <div style={{ ...errorBoxStyle, marginTop: '1rem' }}>{approvalError}</div>}

          {/* Project-level actions */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            {!showRequestChanges && (
              <button type="button" onClick={() => { setShowRequestChanges(true); setShowReject(false); }} style={secondaryBtnStyle()}>Request Changes</button>
            )}
            {!showReject && (
              <button type="button" onClick={() => { setShowReject(true); setShowRequestChanges(false); }} style={{ ...secondaryBtnStyle, color: '#DC2626', borderColor: '#FCA5A5' }}>Reject Project</button>
            )}
            {selectedProject.status !== 'APPROVED' && (
              <button type="button" onClick={handleApproveProject} disabled={approving} style={primaryBtnStyle(approving)}>
                {approving ? 'Approving...' : 'Approve Project'}
              </button>
            )}
          </div>

          {/* Request changes form */}
          {showRequestChanges && (
            <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--aisbp-border, #e2e8f0)', borderRadius: 10, background: 'var(--aisbp-surface, #fff)' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Reason for changes (required)</label>
              <textarea
                value={changesComment}
                onChange={e => setChangesComment(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '0.5rem', borderRadius: 8, border: '1px solid var(--aisbp-border, #e2e8f0)', boxSizing: 'border-box', fontSize: '0.85rem', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button type="button" onClick={handleRequestChanges} disabled={!changesComment.trim() || approving} style={primaryBtnStyle(!changesComment.trim() || approving)}>Submit</button>
                <button type="button" onClick={() => setShowRequestChanges(false)} style={secondaryBtnStyle()}>Cancel</button>
              </div>
            </div>
          )}

          {/* Reject form */}
          {showReject && (
            <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #FCA5A5', borderRadius: 10, background: '#FEF2F2' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#DC2626' }}>Reason for rejection (required)</label>
              <textarea
                value={rejectComment}
                onChange={e => setRejectComment(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '0.5rem', borderRadius: 8, border: '1px solid #FCA5A5', boxSizing: 'border-box', fontSize: '0.85rem', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button type="button" onClick={handleReject} disabled={!rejectComment.trim() || approving} style={{ ...primaryBtnStyle(!rejectComment.trim() || approving), background: '#DC2626' }}>Reject</button>
                <button type="button" onClick={() => setShowReject(false)} style={secondaryBtnStyle()}>Cancel</button>
              </div>
            </div>
          )}
        </PlaceholderCard>
      )}

      {/* Approval events timeline */}
      {selectedProject && approvalEvents.length > 0 && (
        <PlaceholderCard title="Approval Timeline">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {approvalEvents.slice(0, 10).map(event => (
              <div key={event.id} style={{ display: 'flex', gap: '0.75rem', padding: '0.35rem 0', borderBottom: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--aisbp-muted, #64748b)', minWidth: 80 }}>
                  {event.created_at ? new Date(event.created_at).toLocaleTimeString() : '--'}
                </span>
                <span style={{
                  padding: '0.1rem 0.4rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700,
                  background: event.actor_type === 'OPERATOR' ? '#DCFCE7' : '#DBEAFE',
                  color: event.actor_type === 'OPERATOR' ? '#16A34A' : '#1E40AF',
                }}>
                  {event.actor_type}
                </span>
                <span style={{ flex: 1, color: 'var(--aisbp-text, #0f172a)' }}>{event.action.replace(/_/g, ' ')}</span>
                <span style={{ color: 'var(--aisbp-muted, #64748b)' }}>{event.target_id}</span>
              </div>
            ))}
          </div>
        </PlaceholderCard>
      )}

      {/* AI Analysis */}
      {analysis && (
        <PlaceholderCard title="AI Workflow Analysis">
          <div style={{ padding: '0.65rem 0.85rem', background: '#FEF3C7', borderRadius: 10, fontSize: '0.8rem', color: '#92400E', marginBottom: '1rem' }}>
            AI recommendations are drafts only. No KB/GHL sync is active.
          </div>
          {analysis.leadSources && analysis.leadSources.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--aisbp-muted, #64748b)' }}>Lead Sources: </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-text, #0f172a)' }}>{analysis.leadSources.join(', ')}</span>
            </div>
          )}
          {analysis.conversationGoal && (
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--aisbp-muted, #64748b)' }}>Goal: </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-text, #0f172a)' }}>{analysis.conversationGoal.replace(/_/g, ' ')}</span>
            </div>
          )}
          {analysis.primaryCta && (
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--aisbp-muted, #64748b)' }}>Primary CTA: </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-text, #0f172a)' }}>{analysis.primaryCta}</span>
            </div>
          )}
          {analysis.conflictingWorkflows && analysis.conflictingWorkflows.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--aisbp-muted, #64748b)' }}>Pain Points: </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--aisbp-text, #0f172a)' }}>{analysis.conflictingWorkflows.join(', ')}</span>
            </div>
          )}
        </PlaceholderCard>
      )}

      {/* Automation Recommendations */}
      {recommendations.length > 0 && (
        <PlaceholderCard title="Automation Recommendations">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {recommendations.map(rec => (
              <div
                key={rec.id}
                style={{
                  padding: '0.85rem', borderRadius: 10,
                  border: '1px solid var(--aisbp-border, #e2e8f0)',
                  background: 'var(--aisbp-surface, #fff)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--aisbp-text, #0f172a)' }}>{rec.title}</span>
                  <StatusPill status={rec.status} />
                  <span style={{
                    padding: '0.1rem 0.45rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
                    background: rec.riskLevel === 'LOW' ? '#DCFCE7' : rec.riskLevel === 'MEDIUM' ? '#FEF3C7' : '#FEE2E2',
                    color: rec.riskLevel === 'LOW' ? '#16A34A' : rec.riskLevel === 'MEDIUM' ? '#D97706' : '#DC2626',
                  }}>
                    {rec.riskLevel} risk
                  </span>
                </div>
                <p style={{ fontSize: '0.84rem', color: 'var(--aisbp-text-secondary, #334155)', margin: '0 0 0.4rem' }}>
                  {rec.description}
                </p>
                <span style={{ fontSize: '0.75rem', color: 'var(--aisbp-muted, #64748b)' }}>
                  Type: {rec.recommendationType.replace(/_/g, ' ')} · Source: {rec.source.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </PlaceholderCard>
      )}

      {/* Future sections placeholder */}
      <PlaceholderCard title="Onboarding Sections">
        <p style={{ fontSize: '0.85rem', color: 'var(--aisbp-muted, #64748b)', margin: 0 }}>
          Section content editing comes in future PRs. Approval workflow is active for review from PR 6.
        </p>
      </PlaceholderCard>
    </OnboardChrome>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div><span style={{ color: 'var(--aisbp-muted, #64748b)', fontSize: '0.78rem' }}>{label}</span><div style={{ fontWeight: 600, color: 'var(--aisbp-text, #0f172a)' }}>{value}</div></div>;
}
function DetailField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div><label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>{label}</label><input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: 8, border: '1px solid var(--aisbp-border, #e2e8f0)', fontSize: '0.85rem', background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)', boxSizing: 'border-box' }} /></div>;
}
function primaryBtnStyle(disabled: boolean) { return { padding: '0.45rem 1.25rem', borderRadius: 10, border: 'none', background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1 }; }
function secondaryBtnStyle() { return { padding: '0.45rem 1.25rem', borderRadius: 10, border: '1px solid var(--aisbp-border, #e2e8f0)', background: 'var(--aisbp-surface, #fff)', color: 'var(--aisbp-text, #0f172a)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }; }
const errorBoxStyle = { padding: '0.5rem 0.75rem', background: '#FEE2E2', borderRadius: 8, fontSize: '0.82rem', color: '#DC2626', marginBottom: '1rem' };
