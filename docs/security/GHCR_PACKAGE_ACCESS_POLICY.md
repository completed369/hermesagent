# Private GHCR Package Access Policy

Status: FOUNDER APPROVAL REQUIRED before first publication and package configuration.

Private namespace:

- `ghcr.io/completed369/ventureos-api`
- `ghcr.io/completed369/ventureos-web`
- `ghcr.io/completed369/ventureos-worker`
- `ghcr.io/completed369/ventureos-tools`
- `ghcr.io/completed369/ventureos-ingress`

The `publish-images.yml` workflow receives job-scoped `packages: write` only in the protected `image-publication` environment. The founder retains package administration. The deployment host receives a separate GitHub Packages classic PAT with only `read:packages`; it receives no repository, workflow, write, administration, or delete scope. `delete:packages` is prohibited for workflow and deployment credentials.

After first publication, each package must remain private, disable unintended permission inheritance from the public source repository, grant explicit Actions access only to this repository, and grant pull access only to the dedicated deployment identity. Credentials must be stored in the approved vault and rotated after suspected exposure. Package deletion and visibility changes require separate founder authorization.
