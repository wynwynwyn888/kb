# Reply and Tenant Hardening Requirements

## Requirement: Every inbound message has a terminal outcome

The system SHALL record exactly one current terminal outcome for every accepted inbound message.

### Scenario: successful AI reply

- GIVEN a supported inbound message for an enabled autopilot tenant
- WHEN generation and outbound delivery succeed
- THEN the lifecycle ends in `SENT`
- AND the provider message ID and reply ID are recorded
- AND retrying any prior job does not send the same bubble twice

### Scenario: intentional suppression

- GIVEN a message blocked by a business guard
- WHEN orchestration evaluates the guard
- THEN the lifecycle ends in the corresponding `SKIP_*` state
- AND the reason is visible to an authorized operator
- AND the message is not reported as an unknown no-reply

### Scenario: exhausted technical failure

- GIVEN a retryable technical failure
- WHEN all configured attempts and recoveries are exhausted
- THEN the lifecycle ends in `DEAD_LETTER` or a typed `FAILED_*` state
- AND the webhook is not marked completed
- AND an alert event is emitted without raw customer content

## Requirement: Contention cannot discard outbound work

### Scenario: tenant capacity full

- GIVEN a send job whose tenant semaphore is unavailable
- WHEN the worker attempts the send
- THEN the job is failed/delayed for retry
- AND it is not completed with a zero-send summary
- AND the inbound lifecycle remains non-terminal

### Scenario: conversation lock held

- GIVEN a send job whose conversation ordering lock is held
- WHEN the worker attempts the send
- THEN the job is retried after backoff
- AND exactly one job eventually claims each `(tenant, conversation, reply, bubble sequence)` ledger key

## Requirement: Technical orchestration failures retry

### Scenario: transient provider or database failure

- GIVEN orchestration encounters a timeout, 429, 5xx, network error, or transient database error
- WHEN the error is classified
- THEN the BullMQ processor rejects with a retryable error
- AND no webhook-completed marker is written before success or terminal business suppression

## Requirement: Ops data is authorization-scoped

### Scenario: agency user omits tenant filter

- GIVEN an agency user with access to agency A only
- WHEN they list conversations, sends, errors, or audit events without `tenantId`
- THEN results contain only tenants owned by agency A
- AND no tenant from agency B is returned

### Scenario: cross-agency tenant filter

- GIVEN an agency A user
- WHEN they supply a tenant ID belonging to agency B
- THEN the service returns `404` or `403` according to the endpoint policy
- AND performs no target-table query or mutation outside the authorized scope

### Scenario: clear handover by foreign conversation ID

- GIVEN an agency A user and an agency B conversation ID
- WHEN clear-handover is called
- THEN no conversation or handover row changes
- AND the response does not disclose whether the conversation exists

## Requirement: Service-role tenant operations are explicitly scoped

### Scenario: conversation memory load

- GIVEN tenant A and tenant B conversations
- WHEN memory is loaded for tenant A
- THEN the query requires both tenant A and its conversation ID
- AND tenant B rows cannot be returned even if an incorrect conversation ID is supplied

### Scenario: child row ownership mismatch

- GIVEN a child row tenant ID that differs from its parent conversation tenant ID
- WHEN the write is attempted
- THEN the database rejects it through a composite foreign key, trigger, or equivalent constraint

## Requirement: Prompt influence is traceable

### Scenario: generated reply

- GIVEN a reply uses LLM generation
- WHEN the effective prompt is assembled
- THEN a trace records every included layer, source ID, version, priority, hash, original length, included length, and truncation state
- AND records the actual provider/model and fallback status
- AND does not log secrets or unrestricted raw customer content

### Scenario: deterministic reply

- GIVEN booking, menu selection, handover, or another deterministic path bypasses generation
- WHEN the reply plan is produced
- THEN the trace states `generationAttempted=false`
- AND identifies the deterministic path and post-processors

### Scenario: conflict

- GIVEN two configuration layers issue contradictory equal-priority instructions
- WHEN validation or assembly runs
- THEN the system emits a configuration warning with layer identifiers
- AND does not silently claim that the tenant prompt alone controlled the answer

## Requirement: Locale and vertical behavior is tenant-configurable

### Scenario: non-Singapore tenant

- GIVEN a tenant configured with a non-Singapore timezone and language set
- WHEN a flat local webhook timestamp and customer message are processed
- THEN time interpretation uses the tenant IANA timezone
- AND reply language is selected from that tenant's policy
- AND Singapore-only restrictions are not injected

### Scenario: non-salon tenant

- GIVEN a tenant without the salon capability pack
- WHEN a customer asks an unrelated question
- THEN salon/colour-specific suppression is not applied
- AND fixed lead-leak or booking-sales copy is not injected unless configured

## Requirement: Production APIs contain no throwing stubs

### Scenario: production route graph

- GIVEN the production Nest application module
- WHEN registered controllers are inspected
- THEN no route handler is a known `Not implemented` stub
- OR the explicitly retained compatibility route returns HTTP 501 and is documented as disabled
