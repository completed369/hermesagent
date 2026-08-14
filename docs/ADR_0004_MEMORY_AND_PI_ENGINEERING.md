# ADR 0004: Native VentureOS Memory and Sandboxed Pi Engineering Harness

Status: Proposed

## Context

VentureOS agents operate long-running venture workflows that span opportunity research, board review, approvals, product work, marketplace actions, finance, experiments, and subscription/workspace boundaries. The current agent runtime has access to domain services but no dedicated governed long-term memory abstraction.

Separately, the engineering project can benefit from a coding-agent harness that retains repository context across development sessions. Pi is useful for that engineering role, but it is not a security sandbox and project packages/extensions may execute code with the Pi process permissions.

## Decision

### 1. Product memory remains VentureOS-native

Create `@ventureos/memory` as an application-owned package. It must not depend on Pi or any third-party coding-agent memory extension.

Memory records are workspace-scoped and carry workspace identity, memory kind (`FACT`, `DECISION`, `EPISODE`, `PROCEDURE`), subject/key, structured payload, provenance/source reference, confidence, sensitivity classification, creator actor/agent, timestamps, optional expiry/retention metadata, and revocation/supersession metadata.

All read/write operations require an explicit workspace ID. Retrieval never searches across workspaces. Sensitive memory retrieval must pass through the existing policy/security boundary before being exposed to an agent.

The first implementation phase uses deterministic metadata/filter retrieval. Semantic/vector retrieval can be added later behind the same interface after an explicit privacy and cost review.

### 2. Memory is advisory, never an approval bypass

Retrieved memories may inform reasoning, but they cannot substitute for current evidence, founder approval, budget authorization, marketplace publication approval, subscription entitlements, or other policy gates. Durable decisions link to the authoritative audit/approval record rather than copying authority into memory.

### 3. Pi is an engineering harness, not the production agent runtime

Pi is initially used only for repository engineering tasks such as code navigation, implementation, tests, documentation, and review. It runs in a dedicated container as a non-root user with narrowly scoped credentials.

The default Pi environment receives no production secrets. Live provider credentials, payment credentials, Cloudflare credentials, VPS root credentials, and customer data are excluded unless explicitly provided for a reviewed task.

### 4. No unreviewed Pi packages

Third-party Pi packages/extensions are not installed automatically. Each package requires source review and a pinned version before adoption. Pi developer-memory extensions, if adopted, remain separate from `@ventureos/memory` and do not become a production data dependency.

## Consequences

- VentureOS gains a stable memory contract independent of any model/provider or coding-agent framework.
- Tenant isolation and provenance remain first-class.
- Pi can accelerate engineering without expanding the production runtime trust boundary.
- Database persistence and migrations can be introduced behind the memory interface with tenant-isolation regression tests.
