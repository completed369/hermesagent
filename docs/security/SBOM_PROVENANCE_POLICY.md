# SBOM and Provenance Policy

Status: FOUNDER APPROVAL REQUIRED before image publication.

Each of the five images must produce an SPDX JSON SBOM from the exact runner-local archive that passed vulnerability and secret scanning. The workflow uploads that archive and SBOM as one immutable run artifact, publishes those same bytes, records the registry digest, and creates an SBOM attestation for that digest.

Build provenance uses GitHub artifact attestations with GitHub Actions OIDC. Evidence must bind the repository, exact reviewed source SHA, workflow identity, Linux/AMD64 platform, package name, and registry digest. Build and publication jobs may not rebuild or substitute bytes after scanning.

The final manifest must validate against `deploy/private-staging/image-manifest.schema.json`, contain exactly `api`, `web`, `worker`, `tools`, and `ingress`, and be retained with its attestation. Missing or malformed SBOM/provenance evidence fails publication closed.
