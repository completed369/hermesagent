import { createHash, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  type LinuxExecutableAuthorization,
  TestOnlyLinuxExecutableAuthorizationVerifier,
} from './supervision-authorization';
import {
  LinuxExecutableEvidenceReader as ProductionLinuxExecutableEvidenceReader,
  validatedLinuxInspectionFlags,
} from './supervision-evidence-reader';
import { validateSupervisorAdmission } from './supervision-policy';

const createdDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const TEST_SIGNER_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIDXgLTsIlYz/jfY7Or5Ylt4TinBgk8MUM5C+13sON7Uo
-----END PRIVATE KEY-----`;

class LinuxExecutableEvidenceReader extends ProductionLinuxExecutableEvidenceReader {
  constructor(authorizations: readonly unknown[]) {
    super(authorizations, new TestOnlyLinuxExecutableAuthorizationVerifier());
  }
}

function signedAuthorization(
  payload: Omit<LinuxExecutableAuthorization, 'signature'>,
): LinuxExecutableAuthorization {
  return {
    ...payload,
    signature: sign(
      null,
      Buffer.from(canonicalJson(payload), 'utf8'),
      TEST_SIGNER_PRIVATE_KEY,
    ).toString('base64'),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(createdDirectories.splice(0).map((path) => fs.rm(path, { recursive: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'ventureos-supervision-'));
  createdDirectories.push(root);
  const executablePath = join(root, 'reviewed-runtime');
  const content = Buffer.from('# reviewed deterministic executable fixture\n', 'utf8');
  await fs.writeFile(executablePath, content, { mode: 0o500 });
  await fs.chmod(executablePath, 0o500);
  const canonicalPath = await fs.realpath(executablePath);
  const canonicalRoot = await fs.realpath(root);
  const stat = await fs.stat(canonicalPath, { bigint: true });
  const sha256 = createHash('sha256').update(content).digest('hex');
  const identityReference = `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`;
  const now = Date.now();
  const authorization = signedAuthorization({
    schemaVersion: 1,
    authorizationId: 'authorization-reviewed-runtime-v1',
    authorizationVersion: 1,
    signerKeyId: 'ventureos-test-executable-authority-v1',
    validFrom: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 4 * 60_000).toISOString(),
    adapterKind: 'DETERMINISTIC_FAKE',
    testOnly: true,
    canonicalPath,
    sha256,
    identityReference,
    ownerUid: Number(stat.uid),
    ownerGid: Number(stat.gid),
    mode: 0o500,
    authorizedWorktreeRoot: canonicalRoot,
    argumentPolicyReference: 'argument-policy-reviewed-runtime-v1',
  });
  const manifest = {
    schemaVersion: 1,
    manifestId: 'manifest-reviewed-runtime-v1',
    manifestVersion: 1,
    workspaceId: 'workspace-fixture',
    runtimeId: 'runtime-fixture',
    connectionId: 'connection-fixture',
    adapterKind: authorization.adapterKind,
    platform: 'LINUX',
    testOnly: true,
    executable: { canonicalPath, sha256, identityReference },
    argv: ['--mode', 'bounded-fixture'],
    argumentPolicyReference: authorization.argumentPolicyReference,
    worktreeRoot: canonicalRoot,
    workingDirectory: canonicalRoot,
    protocol: 'JSONL_STDIO',
    network: 'DENY',
    shell: false,
    environmentVariableNames: [],
    secretTransport: 'NONE',
    limits: {
      maximumRuntimeMs: 60_000,
      maximumMemoryBytes: 64 * 1_024 * 1_024,
      maximumCpuTimeMs: 30_000,
      maximumInputBytes: 64 * 1_024,
      maximumStdoutBytes: 64 * 1_024,
      maximumStderrBytes: 16 * 1_024,
      maximumChildProcesses: 0,
    },
    platformPolicy: {
      kind: 'LINUX',
      ownerUid: authorization.ownerUid,
      ownerGid: authorization.ownerGid,
      mode: authorization.mode,
      symbolicLink: false,
    },
  } as const;
  return { root, executablePath, authorization, manifest };
}

describe('trusted Linux executable evidence reader', () => {
  it('denies a valid authorization unless a verifier is explicitly injected', async () => {
    const { authorization } = await fixture();

    expect(() => new ProductionLinuxExecutableEvidenceReader([authorization])).toThrow(
      expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }),
    );
  });

  it('rejects malformed and duplicate reviewed authorizations before filesystem access', () => {
    expect(() => new LinuxExecutableEvidenceReader([{ schemaVersion: 1 }])).toThrow(
      expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }),
    );
    const now = Date.now();
    const authorization = signedAuthorization({
      schemaVersion: 1,
      authorizationId: 'authorization-reviewed-runtime-v1',
      authorizationVersion: 1,
      signerKeyId: 'ventureos-test-executable-authority-v1',
      validFrom: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 5 * 60_000).toISOString(),
      adapterKind: 'DETERMINISTIC_FAKE',
      testOnly: true,
      canonicalPath: '/opt/ventureos/reviewed-runtime',
      sha256: 'a'.repeat(64),
      identityReference: 'linux:dev-1:ino-1',
      ownerUid: 10001,
      ownerGid: 10001,
      mode: 0o500,
      authorizedWorktreeRoot: '/workspaces/ventureos',
      argumentPolicyReference: 'argument-policy-reviewed-runtime-v1',
    });
    expect(() => new LinuxExecutableEvidenceReader([authorization, authorization])).toThrow(
      expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }),
    );
    const { signature: _signature, ...payload } = authorization;
    const exactFiveMinuteAuthorization = signedAuthorization({
      ...payload,
      validFrom: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 4 * 60_000).toISOString(),
    });
    expect(() => new LinuxExecutableEvidenceReader([exactFiveMinuteAuthorization])).not.toThrow();
    expect(
      () =>
        new LinuxExecutableEvidenceReader([
          signedAuthorization({
            ...payload,
            validFrom: new Date(now - 60_000).toISOString(),
            validUntil: new Date(now + 4 * 60_000 + 1).toISOString(),
          }),
        ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(
      () => new LinuxExecutableEvidenceReader([signedAuthorization({ ...payload, mode: 0o522 })]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(
      () =>
        new LinuxExecutableEvidenceReader([
          signedAuthorization({ ...payload, testOnly: false, adapterKind: 'REVIEWED_RUNTIME' }),
        ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(
      () => new LinuxExecutableEvidenceReader([{ ...authorization, authorizationVersion: 2 }]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(
      () =>
        new LinuxExecutableEvidenceReader([
          signedAuthorization({
            ...payload,
            validFrom: new Date(now - 10 * 60_000).toISOString(),
            validUntil: new Date(now - 5 * 60_000).toISOString(),
          }),
        ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
  });

  it('fails closed when either mandatory Linux inspection flag is unavailable', () => {
    expect(() =>
      validatedLinuxInspectionFlags({ O_RDONLY: 0, O_NOFOLLOW: 0, O_NONBLOCK: 1 }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PLATFORM' }));
    expect(() =>
      validatedLinuxInspectionFlags({ O_RDONLY: 0, O_NOFOLLOW: 1, O_NONBLOCK: undefined }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PLATFORM' }));
    expect(validatedLinuxInspectionFlags({ O_RDONLY: 0, O_NOFOLLOW: 1, O_NONBLOCK: 2 })).toBe(3);
  });

  it('fails closed on platforms without the reviewed native identity implementation', async () => {
    if (process.platform === 'linux') return;
    const reader = new LinuxExecutableEvidenceReader([]);
    await expect(reader.read({})).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' });
  });

  it.runIf(process.platform === 'linux')(
    'hashes and identifies the same opened regular file and issues short-lived bound evidence',
    async () => {
      const { authorization, manifest } = await fixture();
      const reader = new LinuxExecutableEvidenceReader([authorization]);
      const evidence = await reader.read(manifest);
      const admission = validateSupervisorAdmission(manifest, evidence);
      expect(admission.manifest.executable.sha256).toBe(authorization.sha256);
      expect(admission.evidence.identityReference).toBe(authorization.identityReference);
      expect(Date.parse(evidence.expiresAt) - Date.parse(evidence.observedAt)).toBe(60_000);
      expect(Date.parse(evidence.expiresAt)).toBeLessThanOrEqual(
        Date.parse(authorization.validUntil),
      );
      expect(Object.isFrozen(evidence.platformEvidence)).toBe(true);
      expect(evidence).not.toHaveProperty('execute');
      expect(evidence).not.toHaveProperty('launch');
    },
  );

  it.runIf(process.platform === 'linux')(
    'revalidates authorization expiry before any filesystem access',
    async () => {
      const { authorization, manifest } = await fixture();
      const reader = new LinuxExecutableEvidenceReader([authorization]);
      const openSpy = vi.spyOn(fs, 'open');
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(authorization.validUntil) + 1);

      await expect(reader.read(manifest)).rejects.toMatchObject({
        code: 'INVALID_AUTHORIZATION',
      });
      expect(openSpy).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === 'linux')(
    'rejects privileged modes and a FIFO replacement without blocking',
    async () => {
      const privileged = await fixture();
      await fs.chmod(privileged.executablePath, 0o4500);
      await expect(
        new LinuxExecutableEvidenceReader([privileged.authorization]).read(privileged.manifest),
      ).rejects.toMatchObject({ code: 'UNSAFE_EXECUTABLE' });

      const fifo = await fixture();
      await fs.rename(fifo.executablePath, `${fifo.executablePath}.replaced`);
      await execFileAsync('/usr/bin/mkfifo', [fifo.executablePath]);
      await expect(
        new LinuxExecutableEvidenceReader([fifo.authorization]).read(fifo.manifest),
      ).rejects.toMatchObject({ code: 'UNSAFE_EXECUTABLE' });
    },
  );

  it.runIf(process.platform === 'linux')(
    'rejects opened-file metadata drift during evidence issuance',
    async () => {
      const { authorization, manifest } = await fixture();
      const actualOpen = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementationOnce(async (...arguments_) => {
        const handle = await actualOpen(...arguments_);
        const actualStat = handle.stat.bind(handle);
        let calls = 0;
        handle.stat = (async (...statArguments: Parameters<typeof handle.stat>) => {
          calls += 1;
          const result = (await actualStat(...statArguments)) as BigIntStats;
          return calls === 2 ? { ...result, ctimeNs: result.ctimeNs + 1n } : result;
        }) as typeof handle.stat;
        return handle;
      });
      try {
        await expect(
          new LinuxExecutableEvidenceReader([authorization]).read(manifest),
        ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

  it.runIf(process.platform === 'linux')(
    'rejects atomic path replacement during evidence issuance',
    async () => {
      const { executablePath, authorization, manifest } = await fixture();
      const replacementPath = `${executablePath}.replacement`;
      await fs.writeFile(replacementPath, '# reviewed deterministic executable fixture\n', {
        mode: 0o500,
      });
      await fs.chmod(replacementPath, 0o500);
      const actualOpen = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementationOnce(async (...arguments_) => {
        const handle = await actualOpen(...arguments_);
        const actualStat = handle.stat.bind(handle);
        let calls = 0;
        handle.stat = (async (...statArguments: Parameters<typeof handle.stat>) => {
          calls += 1;
          if (calls === 2) await fs.rename(replacementPath, executablePath);
          return actualStat(...statArguments);
        }) as typeof handle.stat;
        return handle;
      });
      try {
        await expect(
          new LinuxExecutableEvidenceReader([authorization]).read(manifest),
        ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

  it.runIf(process.platform === 'linux')(
    'rejects content replacement, identity drift, writable modes, and symlink paths',
    async () => {
      for (const mutation of ['content', 'identity', 'mode', 'symlink'] as const) {
        const { root, executablePath, authorization, manifest } = await fixture();
        const reader = new LinuxExecutableEvidenceReader([authorization]);
        if (mutation === 'content') {
          await fs.chmod(executablePath, 0o700);
          await fs.writeFile(executablePath, 'changed executable\n');
          await fs.chmod(executablePath, 0o500);
        }
        if (mutation === 'identity') {
          await fs.rename(executablePath, `${executablePath}.replaced`);
          await fs.writeFile(executablePath, '# reviewed deterministic executable fixture\n', {
            mode: 0o500,
          });
        }
        if (mutation === 'mode') await fs.chmod(executablePath, 0o522);
        if (mutation === 'symlink') {
          const target = join(root, 'reviewed-runtime-target');
          await fs.rename(executablePath, target);
          await fs.symlink(target, executablePath);
        }
        await expect(reader.read(manifest)).rejects.toMatchObject({
          code:
            mutation === 'content'
              ? 'DIGEST_MISMATCH'
              : mutation === 'identity'
                ? 'IDENTITY_MISMATCH'
                : 'UNSAFE_EXECUTABLE',
        });
      }
    },
  );

  it.runIf(process.platform === 'linux')(
    'rejects caller manifest drift outside the exact reviewed authorization',
    async () => {
      const { authorization, manifest } = await fixture();
      const reader = new LinuxExecutableEvidenceReader([authorization]);
      await expect(
        reader.read({ ...manifest, argumentPolicyReference: 'argument-policy-other' }),
      ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
    },
  );
});
