import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CORE_SCHEMA, load } from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowRoot = path.join(root, '.github', 'workflows');
const immutableActionReference = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;
const immutableContainerReference = /^(?:docker:\/\/)?[^\s@]+@sha256:[0-9a-f]{64}$/;
const checkoutReference = /^actions\/checkout@[0-9a-f]{40}$/;

function workflowFiles() {
  return fs
    .readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectMergeKeys(value, location = 'workflow') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectMergeKeys(entry, `${location}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  if (Object.hasOwn(value, '<<')) throw new Error(`${location}: YAML merge keys are forbidden`);
  for (const [key, entry] of Object.entries(value)) rejectMergeKeys(entry, `${location}.${key}`);
}

function parseWorkflow(name, source) {
  const workflow = load(source, {
    filename: name,
    schema: CORE_SCHEMA,
    maxAliases: 0,
    maxDepth: 100,
    maxTotalMergeKeys: 0,
  });
  if (!isObject(workflow)) throw new Error(`${name}: workflow root must be a mapping`);
  rejectMergeKeys(workflow, name);
  if (!isObject(workflow.jobs)) throw new Error(`${name}: jobs must be a mapping`);
  return workflow;
}

function triggerNames(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  if (isObject(value)) return Object.keys(value);
  return [];
}

function isPullRequestTriggered(workflow) {
  return triggerNames(workflow.on).some(
    (trigger) => trigger === 'pull_request' || trigger === 'pull_request_target',
  );
}

function hasTrigger(workflow, expected) {
  return triggerNames(workflow.on).includes(expected);
}

function stepsFor(job) {
  if (job.steps === undefined) return [];
  if (!Array.isArray(job.steps)) throw new Error('steps must be an array');
  return job.steps;
}

function permissionWritesContents(permissions) {
  if (permissions === 'write-all') return true;
  return isObject(permissions) && permissions.contents === 'write';
}

function hasExplicitReadOnlyContents(permissions) {
  return isObject(permissions) && ['read', 'none'].includes(permissions.contents);
}

function containsRepositoryCredentialExpression(value) {
  if (typeof value === 'string') {
    const expressions = value.matchAll(/\$\{\{([\s\S]*?)\}\}/g);
    for (const [, expression] of expressions) {
      if (
        /\bsecrets\b/i.test(expression) ||
        /\bgithub\s*(?:\.\s*token\b|\[\s*['"]token['"]\s*\])/i.test(expression)
      ) {
        return true;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(containsRepositoryCredentialExpression);
  if (!isObject(value)) return false;
  return Object.values(value).some(containsRepositoryCredentialExpression);
}

function isExplicitGitPushCommand(command) {
  // Deliberately conservative: global git options, wrappers such as `env git`,
  // and shell variables named GIT must not make an explicit push step invisible.
  return /\bgit\b/i.test(command) && /\bpush\b/i.test(command);
}

function actionViolation(name, location, reference) {
  if (typeof reference !== 'string')
    return `${name}: ${location} action reference must be a string`;
  if (reference.startsWith('./')) return null;
  if (reference.startsWith('docker://')) {
    return immutableContainerReference.test(reference)
      ? null
      : `${name}: mutable or malformed container action ${location} ${reference}`;
  }
  return immutableActionReference.test(reference)
    ? null
    : `${name}: mutable or malformed action reference ${location} ${reference}`;
}

function containerViolation(name, location, container) {
  const image =
    typeof container === 'string' ? container : isObject(container) ? container.image : null;
  if (typeof image !== 'string') return `${name}: ${location}.image must be a string`;
  return immutableContainerReference.test(image)
    ? null
    : `${name}: mutable or malformed container image ${location} ${image}`;
}

function policyViolations(name, source) {
  let workflow;
  try {
    workflow = parseWorkflow(name, source);
  } catch (error) {
    return [`${name}: YAML policy parse failed: ${error.message}`];
  }

  const violations = [];
  const pullRequestTriggered = isPullRequestTriggered(workflow);

  if (hasTrigger(workflow, 'pull_request_target')) {
    violations.push(`${name}: pull_request_target is forbidden`);
  }

  if (pullRequestTriggered && !hasExplicitReadOnlyContents(workflow.permissions)) {
    violations.push(`${name}: pull-request workflow must explicitly set contents read or none`);
  }

  if (pullRequestTriggered && permissionWritesContents(workflow.permissions)) {
    violations.push(`${name}: pull-request workflow grants contents write`);
  }

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!isObject(job)) {
      violations.push(`${name}: jobs.${jobName} must be a mapping`);
      continue;
    }
    if (job.uses !== undefined) {
      const violation = actionViolation(name, `jobs.${jobName}.uses`, job.uses);
      if (violation) violations.push(violation);
    }
    if (job.container !== undefined) {
      const violation = containerViolation(name, `jobs.${jobName}.container`, job.container);
      if (violation) violations.push(violation);
    }
    if (isObject(job.services)) {
      for (const [serviceName, service] of Object.entries(job.services)) {
        const violation = containerViolation(
          name,
          `jobs.${jobName}.services.${serviceName}`,
          service,
        );
        if (violation) violations.push(violation);
      }
    }
    if (pullRequestTriggered && permissionWritesContents(job.permissions)) {
      violations.push(`${name}: pull-request job ${jobName} grants contents write`);
    }
    if (pullRequestTriggered && containsRepositoryCredentialExpression(job)) {
      violations.push(`${name}: pull-request job ${jobName} references a repository credential`);
    }

    let steps;
    try {
      steps = stepsFor(job);
    } catch (error) {
      violations.push(`${name}: jobs.${jobName}.${error.message}`);
      continue;
    }
    for (const [index, step] of steps.entries()) {
      if (!isObject(step)) {
        violations.push(`${name}: jobs.${jobName}.steps[${index}] must be a mapping`);
        continue;
      }
      if (step.uses !== undefined) {
        const violation = actionViolation(name, `jobs.${jobName}.steps[${index}].uses`, step.uses);
        if (violation) violations.push(violation);

        if (typeof step.uses === 'string' && checkoutReference.test(step.uses)) {
          if (!isObject(step.with) || step.with['persist-credentials'] !== false) {
            violations.push(
              `${name}: jobs.${jobName}.steps[${index}] checkout must set persist-credentials false`,
            );
          }
        }
      }
      if (
        pullRequestTriggered &&
        typeof step.run === 'string' &&
        isExplicitGitPushCommand(step.run)
      ) {
        violations.push(`${name}: pull-request job ${jobName} executes git push`);
      }
    }
  }

  return violations;
}

test('all governed workflows satisfy the normalized supply-chain policy', () => {
  const violations = workflowFiles().flatMap((name) =>
    policyViolations(name, fs.readFileSync(path.join(workflowRoot, name), 'utf8')),
  );
  assert.deepEqual(violations, []);
});

test('obsolete Prisma remediation writers cannot return', () => {
  assert.equal(fs.existsSync(path.join(workflowRoot, 'prisma-rust-free-bootstrap.yml')), false);
  assert.equal(fs.existsSync(path.join(workflowRoot, 'prisma-rust-free-lockfile.yml')), false);
});

test('normalized policy rejects flow-style and quoted self-mutation variants', () => {
  const unsafe = `
on: { pull_request: {} }
permissions: { contents: "write" }
jobs:
  unsafe:
    permissions: "write-all"
    steps:
      - { uses: actions/checkout@v4 }
      - { run: "git push origin HEAD:fixed-branch" }
`;
  assert.deepEqual(policyViolations('flow.yml', unsafe), [
    'flow.yml: pull-request workflow must explicitly set contents read or none',
    'flow.yml: pull-request workflow grants contents write',
    'flow.yml: pull-request job unsafe grants contents write',
    'flow.yml: mutable or malformed action reference jobs.unsafe.steps[0].uses actions/checkout@v4',
    'flow.yml: pull-request job unsafe executes git push',
  ]);
});

test('pull-request mutation denial survives git options, credentials and privileged triggers', () => {
  const unsafe = `
on: { pull_request_target: {} }
permissions: { contents: read }
jobs:
  unsafe:
    env:
      RELEASE_TOKEN: \${{ secrets['RELEASE_TOKEN'] }}
    steps:
      - run: git -c credential.helper= push origin HEAD:fixed-branch
`;
  assert.deepEqual(policyViolations('credential.yml', unsafe), [
    'credential.yml: pull_request_target is forbidden',
    'credential.yml: pull-request job unsafe references a repository credential',
    'credential.yml: pull-request job unsafe executes git push',
  ]);

  const wrapper = `
on: [pull_request]
permissions: { contents: none }
jobs:
  unsafe:
    steps:
      - run: env GIT_TRACE=1 $GIT push origin HEAD:fixed-branch
`;
  assert.deepEqual(policyViolations('wrapper.yml', wrapper), [
    'wrapper.yml: pull-request job unsafe executes git push',
  ]);
});

test('normalized policy accepts key spacing but rejects mutable images and missing checkout containment', () => {
  const unsafe = `
on:
  pull_request: { types: [opened] }
permissions:
  contents: read
jobs:
  unsafe:
    container: { image: "example.invalid/tool:latest" }
    services:
      postgres: { image: "postgres:16" }
    steps:
      - uses : actions/checkout@${'a'.repeat(40)}
      - 'uses': docker://alpine:latest
`;
  assert.deepEqual(policyViolations('images.yml', unsafe), [
    'images.yml: mutable or malformed container image jobs.unsafe.container example.invalid/tool:latest',
    'images.yml: mutable or malformed container image jobs.unsafe.services.postgres postgres:16',
    'images.yml: jobs.unsafe.steps[0] checkout must set persist-credentials false',
    'images.yml: mutable or malformed container action jobs.unsafe.steps[1].uses docker://alpine:latest',
  ]);
});

test('normalized policy rejects aliases and merge keys', () => {
  const alias = `on: [pull_request]\njobs:\n  one: &shared { steps: [] }\n  two: *shared\n`;
  assert.match(policyViolations('alias.yml', alias)[0], /YAML policy parse failed/);

  const merge = `on: [pull_request]\njobs:\n  one:\n    <<: { permissions: write-all }\n    steps: []\n`;
  assert.match(policyViolations('merge.yml', merge)[0], /YAML merge keys are forbidden/);
});
