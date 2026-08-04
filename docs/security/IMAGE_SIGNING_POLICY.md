# Image Signing Policy

Status: FOUNDER APPROVAL REQUIRED before image publication.

VentureOS images use Cosign keyless signing with the GitHub Actions OIDC issuer `https://token.actions.githubusercontent.com`. Long-lived signing keys are prohibited.

Verification must require:

1. The exact OCI digest from the approved five-image manifest.
2. The OIDC issuer above.
3. A certificate identity matching only `https://github.com/completed369/hermesagent/.github/workflows/publish-images.yml@refs/heads/<founder-approved-branch>`.
4. GitHub artifact provenance whose source repository, workflow, source commit, and `linux/amd64` platform match the manifest.
5. A matching SPDX SBOM attestation.

The first authorized publication must capture the observed certificate identity and pause before deployment so the founder can approve the exact branch-bound identity expression. Tag-only verification is prohibited.

The publication workflow must fail before checkout/build/signing unless `github.ref` exactly equals the founder-controlled `VENTUREOS_APPROVED_PUBLICATION_REF`, which must be a full `refs/heads/...` value.
