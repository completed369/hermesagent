import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowRoot = path.join(root, '.github', 'workflows');
const immutableActionReference = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;

function workflowFiles() {
  return fs
    .readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
}

function externalActionReferences(source) {
  return source
    .split(/\r?\n/)
    .map((line) => /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line)?.[1])
    .filter((reference) => reference && !reference.startsWith('./'));
}

function isPullRequestTriggered(source) {
  return (
    /^\s{2}pull_request(?:_target)?:\s*(?:#.*)?$/m.test(source) ||
    /^(?:'on'|on):\s*pull_request(?:_target)?\s*(?:#.*)?$/m.test(source) ||
    /^(?:'on'|on):\s*\[[^\]]*\bpull_request(?:_target)?\b[^\]]*\]\s*(?:#.*)?$/m.test(source)
  );
}

function policyViolations(name, source) {
  const violations = [];

  for (const reference of externalActionReferences(source)) {
    const immutableDockerReference = /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/.test(reference);
    if (!immutableActionReference.test(reference) && !immutableDockerReference) {
      violations.push(`${name}: mutable or malformed action reference ${reference}`);
    }
  }

  if (isPullRequestTriggered(source)) {
    if (
      /^\s*contents:\s*write\s*(?:#.*)?$/m.test(source) ||
      /^\s*permissions:\s*write-all\s*(?:#.*)?$/m.test(source) ||
      /^\s*permissions:\s*\{[^\n}]*\bcontents\s*:\s*write\b[^\n}]*\}\s*(?:#.*)?$/m.test(source)
    ) {
      violations.push(`${name}: pull-request workflow grants contents: write`);
    }
    if (/\bgit\s+push\b/.test(source)) {
      violations.push(`${name}: pull-request workflow executes git push`);
    }
  }

  return violations;
}

test('all governed workflows pin external actions to immutable commits', () => {
  const violations = workflowFiles().flatMap((name) =>
    policyViolations(name, fs.readFileSync(path.join(workflowRoot, name), 'utf8')),
  );
  assert.deepEqual(violations, []);
});

test('pull-request workflows cannot write repository contents or push branches', () => {
  for (const name of workflowFiles()) {
    const source = fs.readFileSync(path.join(workflowRoot, name), 'utf8');
    if (!isPullRequestTriggered(source)) continue;
    assert.doesNotMatch(source, /^\s*contents:\s*write\s*(?:#.*)?$/m, name);
    assert.doesNotMatch(source, /^\s*permissions:\s*write-all\s*(?:#.*)?$/m, name);
    assert.doesNotMatch(
      source,
      /^\s*permissions:\s*\{[^\n}]*\bcontents\s*:\s*write\b[^\n}]*\}\s*(?:#.*)?$/m,
      name,
    );
    assert.doesNotMatch(source, /\bgit\s+push\b/, name);
  }
});

test('obsolete Prisma remediation writers cannot return', () => {
  assert.equal(fs.existsSync(path.join(workflowRoot, 'prisma-rust-free-bootstrap.yml')), false);
  assert.equal(fs.existsSync(path.join(workflowRoot, 'prisma-rust-free-lockfile.yml')), false);
});

test('policy rejects representative mutable and self-mutating workflows', () => {
  const mutable = `on: [pull_request]\npermissions:\n  contents: write\njobs:\n  unsafe:\n    steps:\n      - uses: actions/checkout@v4\n      - run: git push origin HEAD:fixed-branch\n`;
  assert.deepEqual(policyViolations('unsafe.yml', mutable), [
    'unsafe.yml: mutable or malformed action reference actions/checkout@v4',
    'unsafe.yml: pull-request workflow grants contents: write',
    'unsafe.yml: pull-request workflow executes git push',
  ]);
});

test('policy covers pull_request_target, inline permissions and mutable container actions', () => {
  const unsafe = `on: pull_request_target\npermissions: { contents: write, issues: read }\njobs:\n  unsafe:\n    container:\n      image: example.invalid/tool:latest\n    steps:\n      - uses: docker://alpine:latest\n`;
  assert.deepEqual(policyViolations('target.yml', unsafe), [
    'target.yml: mutable or malformed action reference docker://alpine:latest',
    'target.yml: pull-request workflow grants contents: write',
  ]);
});
