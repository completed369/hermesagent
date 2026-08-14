# Pi engineering harness

This directory contains the VentureOS-approved baseline for running Pi as an engineering assistant. Pi is not the production VentureOS agent runtime.

## Security boundary

Pi has no built-in sandbox. Run it as the non-root container user defined in `Dockerfile` and pass only credentials required for the current engineering task. Do not mount host credential directories such as `~/.ssh`, `~/.aws`, `~/.config/cloudflared`, or the host Pi auth/session directory.

Do not provide production payment, marketplace, Cloudflare, VPS root, customer, or live provider secrets by default.

Third-party Pi packages/extensions must be source-reviewed and version-pinned before installation.

## Build

Choose and review an explicit Pi release first, then build with a pinned version:

```bash
docker build \
  --build-arg PI_VERSION=<reviewed-version> \
  -t ventureos-pi:<reviewed-version> \
  -f tools/pi/Dockerfile .
```

The build intentionally fails when `PI_VERSION` is omitted so CI or operators cannot silently pull an unreviewed future release.

## Run against a disposable checkout

Prefer a disposable worktree or clone instead of the canonical checkout:

```bash
docker run --rm -it \
  -v "$PWD:/workspace" \
  -v ventureos-pi-home:/home/pi/.pi/agent \
  ventureos-pi:<reviewed-version>
```

A bind mount means Pi can modify the mounted repository. Use a dedicated branch/worktree and normal protected-branch CI/PR rules.

For unattended automation, use a stronger policy-controlled container/VM boundary and short-lived, least-privilege credentials rather than treating this Dockerfile alone as a complete sandbox.
