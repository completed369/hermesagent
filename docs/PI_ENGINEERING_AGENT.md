# Pi engineering agent for VentureOS

This repository includes an isolated Pi coding-agent environment for engineering work. It is not part of the VentureOS production runtime and it must not be given production credentials by default.

## Why it is containerized

Pi is a local coding agent with file and shell tools. Pi's own security documentation states that it does not provide a built-in sandbox; real isolation must come from the operating system, container, VM, or similar boundary. The VentureOS runner therefore uses a dedicated Docker image and Compose service rather than installing Pi as root on the staging/production VPS.

The image pins `@earendil-works/pi-coding-agent` to `0.83.0` and installs it with npm lifecycle scripts disabled. The service drops all Linux capabilities, enables `no-new-privileges`, uses a read-only root filesystem, gives Pi only the repository mount plus its own named state volume, and does not mount the Docker socket, SSH directory, host secret files, or production environment files.

Official references:

- https://pi.dev/docs/latest/quickstart
- https://pi.dev/docs/latest/security
- https://pi.dev/docs/latest/settings

## Build

```bash
docker compose -f docker-compose.pi.yml build pi
```

## Start an interactive session

```bash
docker compose -f docker-compose.pi.yml run --rm pi
```

On the first trusted-project session, Pi may ask whether to trust the project-local `.pi` resources. Review `.pi/settings.json`, `.pi/APPEND_SYSTEM.md`, and `AGENTS.md` before approving. Project trust is not a sandbox; the Docker boundary remains the actual isolation layer.

Use Pi's `/login` flow inside the container if you want to authenticate a supported model provider. Pi's state is persisted only in the `ventureos-pi-home` Docker volume. Do not place provider keys in tracked repository files.

If an API-key environment variable is preferred, pass it explicitly for that run rather than adding it to Compose or Git:

```bash
docker compose -f docker-compose.pi.yml run --rm -e ANTHROPIC_API_KEY pi
```

The same pattern applies to other supported provider variables.

## Project behavior

Pi automatically loads `AGENTS.md`. After project trust is approved it also loads `.pi/APPEND_SYSTEM.md`, which adds VentureOS-specific release, security, founder-gate, tenant-isolation, and verification constraints without replacing Pi's default system prompt.

The expected workflow is branch -> tests -> pull request -> required CI -> merge. Pi must not commit directly to protected `main`, enable live provider/spend switches, publish externally, access financial accounts, perform irreversible production actions, or handle production secrets without a founder-only gate.

## Persistent coding-agent memory

Do not confuse Pi's engineering memory with VentureOS product memory. Product memory lives behind the VentureOS agent-runtime memory API and database migration.

A third-party Pi package such as `pi-persistent-intelligence` can later provide governed coding-session memory, but Pi packages execute code with the Pi process's permissions. For that reason, no third-party package is auto-loaded by `.pi/settings.json` in the initial setup. Any package should be source-reviewed, pinned, and enabled deliberately inside this container boundary.
