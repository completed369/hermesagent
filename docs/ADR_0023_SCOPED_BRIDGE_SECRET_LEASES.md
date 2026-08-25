# ADR-0023: Scoped Agent Bridge secret leases

Status: Proposed (implementation under review)

Date: 2026-08-26

## Context

The durable Agent Bridge stores a secret reference and digest, but previously
accepted a resolver that returned raw bytes without expressing the exact
workspace, runtime, connection, authentication generation, or use. That
interface was too broad to safely connect a future secret backend.

## Decision

Replace raw resolution with a fail-closed lease boundary. Every request binds:

- workspace, runtime, connection, and secret reference;
- the durable expected digest for authentication and frame verification;
- the connection authentication generation; and
- one purpose: provisioning, session authentication, or frame verification.

The resolver validates non-sensitive references before calling its source,
requires 32–4096 bytes of material, checks a durable digest with a constant-time
comparison where applicable, makes a fresh owned copy for each use, and zeros
that copy in `finally`. Directional keys derived by the admission service are
also zeroed in `finally`. Source and lease-validation failures use fixed codes
and do not include source details, references, or secret material. Trusted
consumers retain their domain-specific error semantics and must independently
ensure that those errors contain no secret material.

The production composition root uses a deny-only resolver. The package defines
the interface for a future trusted backend adapter but implements no file,
environment, network, credential-provider, or operating-system source. The
only positive source is local to tests and is not exported by the package.

## Trust and limitations

The source and the in-process consumer are trusted boundaries. A consumer could
copy bytes, and JavaScript does not guarantee physical erasure of every engine
or source-owned copy. Therefore zeroing is defense in depth, not a claim of
secure physical destruction. The source must independently authorize the full
lease scope and return fresh bytes; the lease resolver deliberately does not
cache them.

No secret value, derived key, raw authenticator, or protocol payload is added
to persistence or audit. Existing secret references and digests remain the
only durable secret metadata.

## Explicit non-capabilities

This change adds no secret backend, credentials, file or environment lookup,
network path, controller, child process, runtime adapter, provider activation,
deployment, publication, or status promotion. Codex, Hermes, and Pi remain
`NOT_CONFIGURED`. Configuring a real backend requires a separate security
review and any necessary Founder-approved credential boundary. OS supervision
remains a later, separately reviewed slice.
