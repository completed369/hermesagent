import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deterministicLinuxAdmission,
  deterministicWindowsAdmission,
} from './__tests__/fixtures/deterministic-supervision';
import { validateSupervisorAdmission } from './supervision-policy';

const clone = <T>(value: T): T => structuredClone(value);

describe('runtime OS supervision admission policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it.each([deterministicLinuxAdmission, deterministicWindowsAdmission])(
    'validates and freezes deterministic cross-platform evidence without executing it',
    (fixture) => {
      const { manifest, evidence } = fixture();
      const validated = validateSupervisorAdmission(manifest, evidence);
      expect(validated.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(validated.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(validated.bindingHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.isFrozen(validated)).toBe(true);
      expect(Object.isFrozen(validated.manifest.executable)).toBe(true);
      expect(validated).not.toHaveProperty('execute');
      expect(validated).not.toHaveProperty('launch');
    },
  );

  it('produces stable canonical hashes and rejects untrusted manifest drift', () => {
    const fixture = deterministicLinuxAdmission();
    const first = validateSupervisorAdmission(fixture.manifest, fixture.evidence);
    const second = validateSupervisorAdmission(clone(fixture.manifest), clone(fixture.evidence));
    expect(second).toEqual(first);
    const changedManifest = clone(fixture.manifest);
    (changedManifest.limits as unknown as Record<string, number>).maximumRuntimeMs =
      changedManifest.limits.maximumRuntimeMs + 1;
    expect(() => validateSupervisorAdmission(changedManifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'BINDING_MISMATCH' }),
    );
  });

  it.each([
    ['workingDirectory', '/workspaces/ventureos-fixture/task-two'],
    ['secretTransport', 'INHERITED_HANDLE'],
  ] as const)('binds trusted evidence to manifest authority field %s', (field, value) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'BINDING_MISMATCH' }),
    );
  });

  it('binds trusted evidence to the exact resource limits', () => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest.limits as unknown as Record<string, number>).maximumMemoryBytes =
      fixture.manifest.limits.maximumMemoryBytes + 1;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'BINDING_MISMATCH' }),
    );
  });

  it.each([
    'runtime-fixture',
    '../runtime-fixture',
    '/opt/ventureos/../runtime-fixture',
    '//server/runtime-fixture',
    '/proc/self/exe',
  ])('rejects unsafe Linux executable path %s', (canonicalPath) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>).executable = {
      ...fixture.manifest.executable,
      canonicalPath,
    };
    (fixture.evidence as unknown as Record<string, unknown>).canonicalPath = canonicalPath;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_PATH' }),
    );
  });

  it.each([
    'runtime-fixture.exe',
    'c:\\VentureOS\\runtime-fixture.exe',
    'C:/VentureOS/runtime-fixture.exe',
    '\\\\server\\runtime-fixture.exe',
    '\\\\?\\C:\\VentureOS\\runtime-fixture.exe',
    'C:\\VentureOS\\runtime-fixture.exe:stream',
    'C:\\VentureOS\\..\\runtime-fixture.exe',
    'C:\\VentureOS\\runtime-fixture.cmd',
    'C:\\VentureOS\\runtime-fixture.bat',
    'C:\\VentureOS\\runtime-fixture.ps1',
    'C:\\VentureOS\\CON.exe',
    'C:\\VENTUR~1\\runtime-fixture.exe',
    'C:\\VentureOS\\runtime?.exe',
    'C:\\VentureOS\\runtime\nfixture.exe',
  ])('rejects PATH/PATHEXT, device, UNC, ADS, or ambiguous Windows path %s', (canonicalPath) => {
    const fixture = deterministicWindowsAdmission();
    (fixture.manifest as unknown as Record<string, unknown>).executable = {
      ...fixture.manifest.executable,
      canonicalPath,
    };
    (fixture.evidence as unknown as Record<string, unknown>).canonicalPath = canonicalPath;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_PATH' }),
    );
  });

  it.each([
    ['/bin/sh', 'LINUX'],
    ['/usr/bin/python3', 'LINUX'],
    ['C:\\Windows\\System32\\cmd.exe', 'WIN32'],
    ['C:\\ProgramData\\Runtime\\powershell.exe', 'WIN32'],
  ] as const)('rejects known shell or interpreter executable %s', (canonicalPath, platform) => {
    const fixture =
      platform === 'WIN32' ? deterministicWindowsAdmission() : deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>).executable = {
      ...fixture.manifest.executable,
      canonicalPath,
    };
    (fixture.evidence as unknown as Record<string, unknown>).canonicalPath = canonicalPath;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_PATH' }),
    );
  });

  it('uses component-aware worktree containment', () => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>).workingDirectory =
      '/workspaces/ventureos-fixture-escape/task';
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_PATH' }),
    );
  });

  it('binds containment to the independently trusted worktree root', () => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>).worktreeRoot = '/etc';
    (fixture.manifest as unknown as Record<string, unknown>).workingDirectory = '/etc/ventureos';
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'BINDING_MISMATCH' }),
    );
  });

  it.each([
    ['manifestId', 'password-reference'],
    ['workspaceId', 'chain-of-thought'],
    ['runtimeId', 'glpat-abcdefghijklmnopqrstuvwxyz'],
    ['connectionId', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue'],
    ['adapterKind', 'private-reasoning-worker'],
  ] as const)('rejects sensitive manifest reference %s before hashing it', (field, value) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'INVALID_MANIFEST' }),
    );
  });

  it.each([
    ['evidenceId', 'password-reference'],
    ['identityReference', 'Bearer abcdefghijklmnopqrstuvwxyz'],
  ] as const)('rejects sensitive evidence reference %s before hashing it', (field, value) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.evidence as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );
  });

  it.each([
    ['authorizationId', 'authorization-other'],
    ['authorizationVersion', 2],
    ['authorizationHash', '8'.repeat(64)],
    ['authorizationSignerKeyId', 'signer-other'],
    ['authorizationValidUntil', '2026-08-26T00:03:00.000Z'],
    ['authorizationSignature', `${'A'.repeat(86)}==`],
  ] as const)('rejects unsigned authorization provenance drift in %s', (field, value) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.evidence as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );
  });

  it.each([
    '/opt/ventureos/password/runtime-fixture',
    `/opt/ventureos/${'glpat-abcdefghijklmnopqrstuvwxyz'}/runtime-fixture`,
  ])('rejects sensitive material smuggled through path %s', (canonicalPath) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>).executable = {
      ...fixture.manifest.executable,
      canonicalPath,
    };
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_PATH' }),
    );
  });

  it.each([
    ['workspaceId', 'workspace-other', 'BINDING_MISMATCH'],
    ['runtimeId', 'runtime-other', 'BINDING_MISMATCH'],
    ['connectionId', 'connection-other', 'BINDING_MISMATCH'],
    ['manifestId', 'manifest-other', 'BINDING_MISMATCH'],
    ['manifestVersion', 2, 'BINDING_MISMATCH'],
    ['authorizedManifestHash', '8'.repeat(64), 'BINDING_MISMATCH'],
    ['adapterKind', 'adapter-other', 'INVALID_EVIDENCE'],
    ['authorizedWorktreeRoot', '/workspaces/other', 'INVALID_EVIDENCE'],
    ['argumentPolicyReference', 'argument-policy-other', 'INVALID_EVIDENCE'],
    ['sha256', '8'.repeat(64), 'INVALID_EVIDENCE'],
    ['identityReference', 'device-8:inode-12', 'INVALID_EVIDENCE'],
  ] as const)('rejects exact binding drift in %s', (field, value, code) => {
    const fixture = deterministicLinuxAdmission();
    if (field in fixture.evidence)
      (fixture.evidence as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('binds the exact argv to trusted admission evidence', () => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>).argv = ['--mode', 'other-safe-mode'];
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'BINDING_MISMATCH' }),
    );
  });

  it.each([
    {
      platformEvidence: {
        kind: 'LINUX',
        ownerUid: 10_002,
        ownerGid: 10_001,
        mode: 0o500,
        symbolicLink: false,
      },
    },
    {
      platformEvidence: {
        kind: 'LINUX',
        ownerUid: 10_001,
        ownerGid: 10_001,
        mode: 0o700,
        symbolicLink: false,
      },
    },
    {
      platformEvidence: {
        kind: 'LINUX',
        ownerUid: 10_001,
        ownerGid: 10_001,
        mode: 0o502,
        symbolicLink: false,
      },
    },
    {
      platformEvidence: {
        kind: 'LINUX',
        ownerUid: 10_001,
        ownerGid: 10_001,
        mode: 0o500,
        symbolicLink: true,
      },
    },
    { fileKind: 'DIRECTORY' },
  ])('rejects unsafe or drifted executable identity evidence: %j', (override) => {
    const fixture = deterministicLinuxAdmission();
    Object.assign(fixture.evidence, override);
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow();
  });

  it.each([
    ['argv', ['--mode;rm']],
    ['argv', ['password=hunter2']],
    ['argv', [`Bearer ${'a'.repeat(20)}`]],
    ['argv', ['--token=opaquevalue']],
    ['argv', ['--secret=opaquevalue']],
    ['argv', ['--auth=opaquevalue']],
    ['argv', ['--cookie=opaquevalue']],
    ['argv', ['--session', 'opaquevalue']],
    ['network', 'ALLOW'],
    ['shell', true],
    ['environmentVariableNames', ['TOKEN']],
    ['secretTransport', 'ENVIRONMENT'],
  ] as const)('rejects command, secret, or ambient-authority field %s', (field, value) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow();
  });

  it.each([
    ['maximumRuntimeMs', 999],
    ['maximumRuntimeMs', 30 * 60 * 1_000 + 1],
    ['maximumMemoryBytes', 16 * 1_024 * 1_024 - 1],
    ['maximumCpuTimeMs', 60_001],
    ['maximumInputBytes', 16 * 1_024 * 1_024 + 1],
    ['maximumStdoutBytes', 16 * 1_024 * 1_024 + 1],
    ['maximumStderrBytes', 4 * 1_024 * 1_024 + 1],
    ['maximumChildProcesses', 1],
  ] as const)('rejects unsafe resource limit %s', (field, value) => {
    const fixture = deterministicLinuxAdmission();
    (fixture.manifest.limits as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_LIMIT' }),
    );
  });

  it('bounds argument count, individual bytes, and total bytes before normalization', () => {
    for (const argv of [
      Array.from({ length: 33 }, () => 'x'),
      ['x'.repeat(513)],
      Array.from({ length: 9 }, () => 'x'.repeat(500)),
    ]) {
      const fixture = deterministicLinuxAdmission();
      (fixture.manifest as unknown as Record<string, unknown>).argv = argv;
      expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
        expect.objectContaining({ code: 'UNSAFE_ARGUMENT' }),
      );
    }
  });

  it('rejects sparse or property-extended argv instead of hashing holes as null', () => {
    const sparse = new Array<string>(2);
    sparse[1] = '--mode';
    const extended = ['--mode'] as string[] & Record<string, unknown>;
    extended.extra = 'hidden';
    for (const argv of [sparse, extended]) {
      const fixture = deterministicLinuxAdmission();
      (fixture.manifest as unknown as Record<string, unknown>).argv = argv;
      expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
        expect.objectContaining({ code: 'UNSAFE_ARGUMENT' }),
      );
    }
  });

  it.each([
    { observedAt: '2026-08-26 00:00:00Z' },
    { observedAt: '2026-08-26T00:00:06.000Z' },
    { expiresAt: '2026-08-26T00:00:00.000Z' },
    { expiresAt: '2026-08-26T00:06:00.000Z' },
  ])('rejects stale, future, noncanonical, or overlong evidence: %j', (override) => {
    const fixture = deterministicLinuxAdmission();
    Object.assign(fixture.evidence, override);
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow();
  });

  it('samples its own current clock and ignores an attempted caller clock argument', () => {
    const fixture = deterministicLinuxAdmission();
    vi.setSystemTime(new Date('2026-08-26T00:02:00.000Z'));
    const attemptedBackdate = validateSupervisorAdmission as unknown as (
      manifest: unknown,
      evidence: unknown,
      now: Date,
    ) => unknown;
    expect(() => attemptedBackdate(fixture.manifest, fixture.evidence, fixture.now)).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_EXPIRED' }),
    );
  });

  it('rejects test-only provenance mismatch and fake-adapter escape', () => {
    const fixture = deterministicLinuxAdmission();
    (fixture.evidence as unknown as Record<string, unknown>).testOnly = false;
    expect(() => validateSupervisorAdmission(fixture.manifest, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );
    const adapterEscape = deterministicLinuxAdmission();
    (adapterEscape.manifest as unknown as Record<string, unknown>).adapterKind = 'CODEX_APP_SERVER';
    expect(() =>
      validateSupervisorAdmission(adapterEscape.manifest, adapterEscape.evidence),
    ).toThrow(expect.objectContaining({ code: 'TEST_ONLY_MISMATCH' }));
  });

  it('rejects missing and unknown fields instead of silently normalizing them', () => {
    const fixture = deterministicLinuxAdmission();
    const unknown = { ...fixture.manifest, command: 'runtime-fixture' };
    expect(() => validateSupervisorAdmission(unknown, fixture.evidence)).toThrow(
      expect.objectContaining({ code: 'INVALID_MANIFEST' }),
    );
    const missing = clone(fixture.evidence) as unknown as Record<string, unknown>;
    delete missing.identityReference;
    expect(() => validateSupervisorAdmission(fixture.manifest, missing)).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );
  });
});
