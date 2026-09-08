# ADR-0164: Inactive worker service-authority client composition

Date: 2026-09-08

## Context

ADR-0163 completed the inactive API listener side of authenticated worker-listener grant delivery.
The worker still had no composition joining its independently authenticated API root source, worker
signer, native client, local kernel identity authorization, signed carrier, and one-use service
authority.

## Decision

Add a worker-local composition module that can:

- validate an already-loaded native `CLIENT` envelope and the exact authorized API listener socket;
- enforce the expected retained socket identity before connect and the expected API
  `SO_PEERCRED` identity before writing any grant-request bytes;
- bind the strict native client to the bounded canonical frame channel, worker-initiated Ed25519
  carrier, and exact `TOPOLOGY_CARRIER_WORKER_LISTENER` service authority; and
- optionally consume one explicit module loader after resolving only the `API_COORDINATOR` public
  root through the existing one-use mutually authenticated worker root source.

The composition is not imported by `worker.ts` or any startup entry point.

## Security and runtime-truth boundary

- Module path, authority socket, kernel endpoint identity, API peer credentials, carrier scope,
  worker-listener request, signer, and API root remain exact constructor inputs.
- Socket identity is checked from raw `lstat(2)` evidence before connect. Peer identity is checked
  from raw `SO_PEERCRED` evidence before the signed grant request can be written.
- The existing local client still rechecks the socket after the response; the outer adapter also
  authenticates both endpoint observations and the connected peer before releasing response bytes.
- Root-source or loader failures are redacted to `INVALID_AUTHORIZATION`; malformed and substituted
  roots, signatures, responses, grants, bindings, roles, and runtime truth fail closed.
- Construction and loading do not connect the authority socket. The returned authority is one-use,
  bounded to 100–5,000 ms, closes on every exchange path, and grants only a fresh Level-3 worker
  listener session.
- No production path, identity, signer custody, key custody, process, listener, lifecycle, or route
  is selected. No provider activation, deployment, publication, spend, DNS change, commercial
  commitment, or Level-4 action occurs.
- Codex, Hermes, Pi, and `runtimeConnection` remain `NOT_CONFIGURED`.

## Consequences

Both inactive ends of the authenticated one-session worker-listener authority-delivery channel can
now be composed from explicit inputs. Remaining activation work is Founder-gated selection and
custody of production identities, paths, keys, native artifacts, and lifecycle wiring; those inputs
must not be inferred or activated by this change.
