# Integrations

## Phase 1 integrations (all seeded as disconnected/mock)

| Provider | Mode | Write enabled | Purpose |
|---|---|---|---|
| minio | READ_ONLY | No | Object storage health check |
| etsy | MOCK | No | Placeholder for Phase 4/6 marketplace adapter |
| ai-mock | MOCK | No | Placeholder for Phase 3 AI provider |

All three are visible on the Command Centre "Integration status" table,
sourced from the real `Integration` table (not hardcoded UI).

## Adapter pattern

`packages/integrations/src/storage` is the reference implementation: a
`StorageProvider` interface, a real `MinioStorageProvider`, and a
`MockStorageProvider` used in tests. The same shape will be used for:
`AiProvider` (Phase 3, `packages/agent-runtime` — currently just a README
stub) and marketplace adapters (Phase 4/6,
`packages/integrations/src/marketplace` — directory exists, empty).

## Write-enabled integrations start disabled

Per master spec policy POL-013 (not yet in `evaluateCorePolicies` since no
integration triggers a write today, but enforced structurally):
`Integration.writeEnabled` defaults to `false` in the Prisma schema and the
seed script never sets it to `true`.
