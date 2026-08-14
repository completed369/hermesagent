# Pi engineering harness

This directory contains the VentureOS-approved baseline for running Pi as an engineering assistant. Pi is not the production VentureOS agent runtime.

## Reviewed version

The harness is pinned to `@earendil-works/pi-coding-agent@0.84.1` (released 2026-08-07). The upstream release publishes a versioned source archive and digest, and the Docker build verifies the installed CLI responds to `pi --version`.

Upgrades are deliberate changes: review the upstream release/changelog, change the exact version in `Dockerfile`, and let the normal VentureOS PR/CI process review that diff. Do not use `latest` or an unbounded package range.

## Security boundary

Pi has no built-in sandbox. Run it as the non-root container user defined in `Dockerfile` and pass only credentials required for the current engineering task. Do not mount host credential directories such as `~/.ssh`, `~/.aws`, `~/.config/cloudflared`, or the host Pi auth/session directory.

Do not provide production payment, marketplace, Cloudflare, VPS root, customer, or live provider secrets by default.

Third-party Pi packages/extensions must be source-reviewed and version-pinned before installation.

## Build

Build the reviewed pinned release:

```bash
docker build -t ventureos-pi:0.84.1 -f tools/pi/Dockerfile .
```

The Dockerfile rejects a different `PI_VERSION` value. Updating Pi therefore requires a reviewed source change rather than a runtime flag.

## Run against a disposable checkout

Prefer a disposable worktree or clone instead of the canonical checkout:

```bash
docker run --rm -it \
  -v "$PWD:/workspace" \
  -v ventureos-pi-home:/home/pi/.pi/agent \
  ventureos-pi:0.84.1
```

A bind mount means Pi can modify the mounted repository. Use a dedicated branch/worktree and normal protected-branch CI/PR rules.

For unattended automation, use a stronger policy-controlled container/VM boundary and short-lived, least-privilege credentials rather than treating this Dockerfile alone as a complete sandbox.
