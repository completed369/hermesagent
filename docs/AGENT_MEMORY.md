# VentureOS Agent Memory

VentureOS agent memory is durable workspace-scoped state for facts, decisions, episodes, and procedures that should survive individual agent runs. It is product memory for VentureOS itself; it is separate from any coding-agent session memory used to engineer this repository.

## Safety model

Every memory record belongs to exactly one workspace. The public runtime API always requires `workspaceId`, and recall queries include that workspace boundary in SQL. There is no cross-workspace/global recall API.

Durable memory is not silently rewritten. Corrections create a new record that references `supersedesId`; the previous record becomes `SUPERSEDED` in the same database transaction. This preserves history and makes correction behavior reviewable.

Every record carries provenance (`sourceType` and optional `sourceRef`), confidence from 0 to 1, sensitivity, importance, optional expiry, tags, and optional agent identity/metadata. `RESTRICTED` records are excluded from recall unless the caller deliberately opts in.

The memory table is migration-managed and is intentionally accessed through `packages/agent-runtime/src/memory.ts` rather than exposed as an ad-hoc generated-model write surface. This keeps tenant scoping, validation, sensitivity defaults, and supersession behavior in one narrow repository API.

## Memory types

- `FACT` — durable factual context with provenance.
- `DECISION` — a decision and its rationale or governing outcome.
- `EPISODE` — a notable run/outcome that should influence future work.
- `PROCEDURE` — a reusable operational lesson or playbook.

Memory is not evidence. Material business claims still use the Evidence Trail and its claim classifications. A memory may point to evidence or another durable record through `sourceRef`, but memory must not upgrade an assumption into a verified fact.

## Runtime API

`rememberMemory()` validates and stores one durable record.

`recallMemories()` returns active, non-expired records for one workspace, ordered by importance and recency. It supports bounded type/text/tag filtering and defaults to excluding `RESTRICTED` content.

`supersedeMemory()` locks the existing active record, inserts its replacement, and marks the old record superseded atomically.

There is deliberately no hard-delete API in the agent runtime. Privacy/retention deletion should be implemented as a separately authorized administrative capability with audit evidence rather than as an agent convenience method.

## Next integration steps

After this storage/runtime foundation passes CI, board/research/finance workflows can add memory capture at explicit successful decision boundaries, and prompts can receive bounded recall context before agent execution. Memory injection must remain source-labelled, size-bounded, and subordinate to deterministic policy checks.
