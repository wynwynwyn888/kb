# KB RAG Production Safety Specification

## ADDED Requirements

### Requirement: Live KB Retrieval Ignores Legacy Pseudo-Vectors

Live KB retrieval and KB search SHALL ignore legacy 64-dimensional pseudo-vector arrays stored in `knowledge_chunks.metadata.embedding`.

#### Scenario: Retrieval remains keyword when metadata embeddings exist

- **GIVEN** READY chunks for a tenant include `metadata.embedding` numeric arrays
- **WHEN** `KbService.retrieve()` is called
- **THEN** retrieval SHALL use the normal keyword scoring path
- **AND** the returned `retrievalMode` SHALL be `keyword`
- **AND** the legacy pseudo-vector helpers SHALL NOT score or rank the chunks

#### Scenario: KB search remains keyword when metadata embeddings exist

- **GIVEN** READY chunks for a tenant include `metadata.embedding` numeric arrays
- **WHEN** `KbService.searchKnowledge()` is called
- **THEN** search SHALL use the normal keyword scoring path
- **AND** the returned `retrievalMode` SHALL be `keyword`
- **AND** `metadata.embedding` SHALL NOT bypass keyword search

#### Scenario: Legacy metadata is observability only

- **GIVEN** chunks include legacy `metadata.embedding`
- **WHEN** live retrieval or search ignores those embeddings
- **THEN** the system MAY log a bounded count of ignored legacy embeddings
- **AND** the log SHALL NOT include raw chunk content, full customer text, secrets, or embedding vectors

### Requirement: Existing Keyword KB Prompt Behavior Is Preserved

The safety fix SHALL preserve the existing production keyword KB behavior.

#### Scenario: Flags unset preserves keyword context

- **GIVEN** all RAG/vector/embedding feature flags are unset or false
- **WHEN** a tenant has relevant keyword KB chunks
- **THEN** the normal keyword retrieval result SHALL remain available to the existing orchestration path
- **AND** normal keyword KB context behavior SHALL NOT be disabled by vector-context flags

#### Scenario: Non-canary tenants are unaffected

- **GIVEN** a tenant is not listed in any vector or embedding allowlist
- **WHEN** the tenant uses KB retrieval or KB search
- **THEN** the tenant SHALL receive keyword-only behavior
- **AND** no vector retrieval, vector context injection, embedding job, or backfill SHALL run for that tenant

### Requirement: Production Data Rollback Requires Explicit Approval

Removing legacy `metadata.embedding` from AISBP production chunks SHALL be treated as a separate production data operation requiring explicit owner approval.

#### Scenario: Code fix does not mutate production data

- **WHEN** this safety fix is implemented, tested, merged, or deployed
- **THEN** it SHALL NOT update production `knowledge_chunks`
- **AND** it SHALL NOT run AISBP rollback SQL
- **AND** it SHALL NOT run embedding backfill
- **AND** it SHALL NOT enable RAG/vector feature flags

#### Scenario: AISBP rollback is tenant-scoped when approved

- **GIVEN** the owner explicitly approves the AISBP metadata rollback
- **WHEN** the rollback SQL is run
- **THEN** it SHALL remove only the `embedding` key from `metadata` for chunks whose parent document belongs to tenant `34c62859-95b1-49a8-911c-cc44ced05452`
- **AND** it SHALL preserve documents, chunks, content, vaults, and all other metadata keys
- **AND** it SHALL report before and after counts for documents, chunks, legacy metadata embeddings, and rows updated
