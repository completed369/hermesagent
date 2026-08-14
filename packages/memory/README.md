# @ventureos/memory

Governed, workspace-scoped long-term memory contract for VentureOS agents.

## Invariants

1. Every read and write is explicitly scoped to one workspace.
2. Memory is advisory context; it never grants approval, budget authority, publication rights, subscription entitlements, or policy exceptions.
3. Every durable memory has provenance and confidence metadata.
4. Revoked, expired, and superseded memory is excluded from default retrieval.
5. Product memory has no dependency on Pi or coding-agent memory plugins.
6. Semantic/vector retrieval must remain behind this package interface and is not enabled by default.

The initial package defines the contract and governance helpers. Persistence, retention jobs, audit emission, and agent-runtime integration will be added behind this interface with tenant-isolation tests.
