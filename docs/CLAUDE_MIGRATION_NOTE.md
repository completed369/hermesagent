# Claude Code migration note

This migration does not replace VentureOS product policy or GitHub evidence. Claude Code must follow the root `CLAUDE.md`, `AGENTS.md`, current roadmap/ADRs, protected CI, and exact Git/GitHub state.

## Founder-only context outside GitHub

The complete original 46-section founder master build prompt is not duplicated verbatim in this repository. Preserve it separately and provide it to Claude when a requirement depends on founder intent that is not fully represented by current repository documentation.

Do not store passwords, API keys, SSH private keys, production credentials, customer data, or other secrets in this repository or in prompts.

## Recommended Claude Code operating mode

- Work one narrowly bounded PR at a time.
- Prefer targeted repository reads and tests instead of repeatedly loading the full historical corpus.
- Use current open PRs as the first continuation point before starting overlapping work.
- Stop at merge-ready/merged and report exactly one next bounded slice.
- Treat deployment, publication, spend, provider activation, production credentials, DNS/infrastructure changes, and other Level-4 actions as separately founder-gated.

## First-session objective

On the first Claude Code session after migration, perform a read-only recovery first: fetch current Git/GitHub state, inspect open PRs and exact CI, read the root operating files, identify stale historical documents, and report the single current highest-priority safe continuation. Do not modify code until that recovery is complete.
