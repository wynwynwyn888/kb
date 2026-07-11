# Backup and Rollback Guide

## Backup created before implementation

Timestamp: `2026-07-11 16:12:55 Asia/Singapore`

Directory:

`/Users/wyn/Backups/kb-explore-20260711-161255`

Artifacts:

- `kb-explore-source-dirty.tar.gz` — source tree including pre-existing uncommitted and untracked files; excludes reproducible `node_modules`, `.next`, `.turbo`, and `.git`.
- `kb-explore-history.bundle` — complete Git refs/history at backup time.

SHA-256:

```text
65eab6a4d83c1b1361797ff48fd3a1c0c0732a0cece823a85e320f7cf47a14ef  kb-explore-source-dirty.tar.gz
405a1b93cc4f545f532f0e7f20f3ea6a36f83eacd1dd984ca1f34f8f0af663d3  kb-explore-history.bundle
```

The source archive may contain local environment files and secrets. Keep it local with restricted permissions; do not upload it to a ticket or public storage.

## Verify backup

```bash
shasum -a 256 /Users/wyn/Backups/kb-explore-20260711-161255/*
tar -tzf /Users/wyn/Backups/kb-explore-20260711-161255/kb-explore-source-dirty.tar.gz | head
git bundle verify /Users/wyn/Backups/kb-explore-20260711-161255/kb-explore-history.bundle
```

## Restore into a separate directory

Never restore over the live working tree first.

```bash
mkdir -p /Users/wyn/Restore/kb-explore-20260711-161255
tar -xzf /Users/wyn/Backups/kb-explore-20260711-161255/kb-explore-source-dirty.tar.gz \
  -C /Users/wyn/Restore/kb-explore-20260711-161255
```

Reinstall dependencies in the restored directory with the repository's locked package-manager command.

To reconstruct committed history separately:

```bash
git clone /Users/wyn/Backups/kb-explore-20260711-161255/kb-explore-history.bundle \
  /Users/wyn/Restore/kb-explore-history
```

## Code rollback strategy

Rollback by phase/commit, not with `git reset --hard`. Preserve user changes.

1. Stop rollout or disable only safe new behavior flags.
2. Revert the specific implementation commit with `git revert <commit>`.
3. Run focused tests and a smoke test.
4. Redeploy the reverted build.
5. Confirm queue depths, send failures, duplicate-prevention events, and cross-tenant authorization.

Do not restore the known silent-discard behavior as a feature-flag fallback. If retry behavior must be disabled, replace it with a safe explicit delayed job or terminal failure/alert—not successful completion.

## Queue rollback and incident handling

- Pause consumers before changing retry/idempotency semantics during an incident.
- Do not bulk retry jobs with `provider_outcome_unknown`; reconcile them first to avoid duplicate customer messages.
- Retain failed jobs and export their IDs/statuses before draining.
- Resume consumers gradually and monitor per-tenant concurrency.
- Never obliterate a queue as a routine rollback step.

## Database rollback

P0 reliability and ops authorization changes should not require destructive schema rollback.

For later additive tenant columns/RLS work:

- Prefer roll-forward fixes.
- Do not drop populated tenant columns during rollback.
- Disable a newly applied policy only after confirming application authorization remains fail-closed.
- Revert application reads to old columns if necessary while preserving dual-written data.
- Keep migration verification queries and row counts with the deployment record.
- Security authorization fixes must not be rolled back to known cross-tenant access.

### Message/handover tenant-boundary rollback

Migration `20260711170000_tenant_owned_messages_handovers` is additive. Its
preferred rollback is application rollback while retaining `tenant_id`, indexes,
backfilled values, and foreign keys.

If an RLS policy causes an authenticated direct-client incident, first confirm
the backend service-role path and API authorization remain healthy. Temporarily
disable only the affected table's RLS while a corrected membership policy is
prepared:

```sql
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.handover_events DISABLE ROW LEVEL SECURITY;
```

Re-enable RLS immediately after the corrected policies have been validated.
Do not drop the ownership triggers or tenant columns during an incident. They
prevent mismatched cross-tenant child rows and are compatible with the previous
application version because they derive a missing `tenant_id` from the parent
conversation.

Before and after rollout, record these checks:

```sql
SELECT count(*) FROM public.messages WHERE tenant_id IS NULL;
SELECT count(*) FROM public.handover_events WHERE tenant_id IS NULL;

SELECT count(*)
FROM public.messages m
JOIN public.conversations c ON c.id = m.conversation_id
WHERE m.tenant_id IS DISTINCT FROM c.tenant_id;

SELECT count(*)
FROM public.handover_events h
JOIN public.conversations c ON c.id = h.conversation_id
WHERE h.tenant_id IS DISTINCT FROM c.tenant_id;
```

All four counts must be zero before later enforcement of `NOT NULL`. Composite
child-to-conversation foreign keys are intentionally deferred because retaining
both the legacy and composite relationships makes PostgREST embedded joins
ambiguous. The write-time ownership trigger supplies mismatch enforcement in
this phase.

Assistant Profile ↔ Knowledge Vault links follow the same additive pattern in
migration `20260711190000_tenant_own_profile_vault_links`: retain the nullable
`tenant_id`, validation trigger, direct tenant foreign key, index, and RLS during
an application rollback. Before enforcing `NOT NULL`, verify:

```sql
SELECT count(*)
FROM public.tenant_bot_profile_knowledge_vaults
WHERE tenant_id IS NULL;

SELECT count(*)
FROM public.tenant_bot_profile_knowledge_vaults link
JOIN public.tenant_bot_profiles profile ON profile.id = link.profile_id
JOIN public.knowledge_vaults vault ON vault.id = link.vault_id
WHERE link.tenant_id IS DISTINCT FROM profile.tenant_id
   OR link.tenant_id IS DISTINCT FROM vault.tenant_id;
```

## Prompt/locale rollback

- Roll tenant-by-tenant through explicit compatibility settings.
- Preserve the platform anti-hallucination/no-KB safety contract.
- If prompt traces cause load, disable trace persistence while retaining reply behavior.
- If locale migration is wrong, restore the tenant's previous explicit timezone/language policy; do not restore a fleet-wide hardcoded assumption for all tenants.

## Post-rollback validation

- One inbound message produces one observable terminal decision.
- Lock/capacity contention does not silently complete.
- No duplicate provider sends appear for the same reply/bubble correlation key.
- Agency A cannot read or mutate Agency B.
- AI-off and handover remain fail-closed.
- Existing tenant prompt and KB behavior remains available.
