# Sales Playbook authority implementation

## Goal

Make editable prompt conflicts resolve in this order: Global Prompt, Critical Facts, Sales Playbook, then the remaining tenant sections. Keep replies AI-generated and contextual while separating normal hesitation from explicit opt-out.

## Runtime changes

- Reorder the shared section assembler used by live replies.
- Add an explicit conflict-resolution declaration while preserving platform safety and legal requirements above editable prompts.
- Classify ordinary negative/uncertain replies as `HESITATION`.
- Classify only clear stop-contact requests as `EXPLICIT_OPT_OUT`.
- Do not present `UNKNOWN` to generation as a meaningful intent decision.
- Tell generation to interpret hesitation from recent context and the higher-priority Sales Playbook.
- Preserve the existing natural hesitation safety retry.
- Use the same hierarchy in Preview Bot and live WhatsApp.
- Keep normal reply history at its existing default of 20 messages.

## Tenant prompt cleanup

Replace only the conflicting Conversation Goals paragraph documented in the central production backup. Do not alter Sales Playbook content, Critical Facts, temperature, model, token limits, KB records, or customer data.

## Verification gates

- Classification: `hmm`, `let me consider`, `no`, and `no thanks` are hesitation.
- Opt-out: `stop`, `unsubscribe`, and explicit no-contact phrases are opt-out.
- Ambiguous `cancel` is not treated as global opt-out.
- Generation receives contextual Sales Playbook guidance for hesitation.
- `UNKNOWN` does not become an AI-facing intent command.
- Preview and live prompt hierarchy match.
- Existing natural hesitation retry remains active.
- Focused tests, backend typecheck, monorepo backend build, full CI, deployment health, and production code-presence checks must pass.
