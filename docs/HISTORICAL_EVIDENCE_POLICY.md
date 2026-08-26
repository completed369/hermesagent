# Historical evidence policy

VentureOS preserves reviewed facts in curated, dated documentation and relies
on exact GitHub checks or authorized protected operational evidence for mutable
state. Raw local command transcripts, build logs, test logs, and development
console captures are not durable release evidence and must not be committed.

The repository artifact-hygiene check examines every tracked path and rejects
raw log and transcript filename variants. `.gitignore` provides an additional
prospective convenience boundary, while CI remains the authoritative tracked-
file check. Curated Markdown documents, source code, schemas, migrations, and
deliberately reviewed test fixtures remain allowed.

The 2026-08-26 cleanup removed legacy root-level logs and a chat transcript from
the current tree after confirming that no build or executable path depends on
them. Dated historical status reports may still name those removed artifacts as
evidence observed at the time; those citations do not make the raw files current
or durable release evidence. This reduces ongoing privacy, path-disclosure, and
stale-evidence risk. It does **not** rewrite or purge Git history: earlier commits
may still contain the removed files. Any future discovery of a real secret or
regulated personal data in history requires a separate incident response,
credential rotation where applicable, and an explicitly authorized
history-remediation decision.

Deleting a raw artifact is not evidence that its historical result passed or
failed. Current status claims must continue to distinguish source, CI,
publication, deployment, verification, pilot, and production evidence.
