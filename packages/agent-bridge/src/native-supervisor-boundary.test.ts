import { createHash, sign } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import type { RuntimeProcessLauncher } from './policy';
import {
  linuxExecutableAuthorizationHash,
  TestOnlyLinuxExecutableAuthorizationVerifier,
  type LinuxExecutableAuthorization,
  type LinuxExecutableAuthorizationPayload,
} from './supervision-authorization';
import {
  type PerAdmissionSupervisorEvidenceReader,
  type TrustedNativeLaunchHandoffConsumer,
  TrustedSupervisorComposition,
  type TrustedSupervisorAuthorizationRequest,
  type TrustedSupervisorAuthorizationSource,
} from './supervisor-composition';
import type {
  RuntimeLaunchManifest,
  TrustedSupervisorAdmissionEvidence,
} from './supervision-policy';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const nativeSourceRoot = resolve(__dirname, '..', 'test', 'native');
const nativeRequire = createRequire(__filename);

interface NativeEvidence {
  readonly schemaVersion: 1;
  readonly sourceDigest: string;
  readonly sealedDigest: string;
  readonly execveatSucceeded: true;
  readonly emptyEnvironment: true;
  readonly noNewPrivileges: true;
  readonly resourceLimitsVerified: true;
  readonly socketDeniedBySeccomp: true;
  readonly childCreationDeniedBySeccomp: true;
  readonly sessionEscapeDeniedBySeccomp: true;
  readonly retainedWorkingDirectoryVerified: true;
  readonly termEscalatedToKill: true;
  readonly pidfdObservedExit: true;
  readonly processGroupGone: true;
}

const TEST_SIGNER_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIDXgLTsIlYz/jfY7Or5Ylt4TinBgk8MUM5C+13sON7Uo
-----END PRIVATE KEY-----`;
const hash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
let decisionSequence = 0;

class NativeAuthorizationSource implements TrustedSupervisorAuthorizationSource {
  constructor(private readonly authorization: LinuxExecutableAuthorization) {}

  async read(request: Readonly<TrustedSupervisorAuthorizationRequest>): Promise<unknown> {
    decisionSequence += 1;
    return {
      schemaVersion: 1,
      decisionId: `native-decision-${decisionSequence}`,
      supervisionId: `native-supervision-${decisionSequence}`,
      launchNonce: `native-launch-nonce-${decisionSequence}`,
      requestHash: hash(request),
      authorization: this.authorization,
    };
  }
}

class NativeEvidenceReader implements PerAdmissionSupervisorEvidenceReader {
  constructor(private readonly evidence: TrustedSupervisorAdmissionEvidence) {}

  async read(): Promise<TrustedSupervisorAdmissionEvidence> {
    return this.evidence;
  }
}

class NativeFixtureCompleted extends Error {}

class NeverCalledLauncher implements RuntimeProcessLauncher {
  calls = 0;

  factory() {
    return (): RuntimeProcessLauncher => this;
  }

  async launch(): Promise<never> {
    this.calls += 1;
    throw new Error('Unexpected native launch');
  }
}

interface NativeSupervisorAddon {
  bind(consumer: (handoff: unknown) => readonly string[]): (handoff: unknown) => string;
}

class NativeExecveatRuntimeProcessLauncher implements RuntimeProcessLauncher {
  calls = 0;
  evidence?: NativeEvidence;
  #nativeLaunch?: (handoff: unknown) => string;
  #lastHandoff?: unknown;
  #pendingNext = false;
  #pendingReject?: (reason: Error) => void;

  constructor(
    private readonly addon: NativeSupervisorAddon,
    private readonly expectedManifest: Readonly<RuntimeLaunchManifest>,
    private readonly expectedSize: bigint,
  ) {}

  factory() {
    return (consume: TrustedNativeLaunchHandoffConsumer): RuntimeProcessLauncher => {
      this.#nativeLaunch = this.addon.bind((handoff) => this.boundTuple(consume(handoff)));
      return this;
    };
  }

  private boundTuple(envelope: ReturnType<TrustedNativeLaunchHandoffConsumer>): readonly string[] {
    const request = envelope.request;
    const manifest = request.manifest;
    if (
      hash(manifest) !== hash(this.expectedManifest) ||
      envelope.admission.manifestHash !== hash(manifest) ||
      canonicalJson(envelope.admission.manifest) !== canonicalJson(manifest) ||
      !/^[a-f0-9]{64}$/u.test(envelope.planHash) ||
      envelope.expiresAt !== Date.parse(envelope.admission.evidence.expiresAt) ||
      manifest.platform !== 'LINUX' ||
      manifest.platformPolicy.kind !== 'LINUX' ||
      manifest.adapterKind !== 'DETERMINISTIC_FAKE' ||
      manifest.testOnly !== true ||
      canonicalJson(manifest.argv) !== canonicalJson(['--mode', 'jsonl-fixture']) ||
      manifest.workingDirectory !== `${manifest.worktreeRoot}/work` ||
      manifest.limits.maximumRuntimeMs !== 60_000 ||
      manifest.limits.maximumMemoryBytes !== 64 * 1_024 * 1_024 ||
      manifest.limits.maximumCpuTimeMs !== 2_000 ||
      manifest.limits.maximumChildProcesses !== 0
    )
      throw new Error('Native fixture launch request denied');
    const identity = /^linux:dev-([a-f0-9]+):ino-([a-f0-9]+)$/u.exec(
      envelope.admission.evidence.identityReference,
    );
    if (!identity || envelope.expiresAt <= Date.now())
      throw new Error('Native fixture launch evidence denied');
    this.calls += 1;
    return Object.freeze([
      manifest.executable.canonicalPath,
      manifest.worktreeRoot,
      manifest.executable.sha256,
      String(manifest.platformPolicy.ownerUid),
      String(manifest.platformPolicy.ownerGid),
      String(manifest.platformPolicy.mode),
      BigInt(`0x${identity[1]}`).toString(),
      BigInt(`0x${identity[2]}`).toString(),
      this.expectedSize.toString(),
      String(envelope.expiresAt),
    ]);
  }

  directNativeCall(...argumentsList: unknown[]): string {
    if (!this.#nativeLaunch) throw new Error('Native fixture launcher was not composed');
    return (this.#nativeLaunch as (...argumentsList: unknown[]) => string)(...argumentsList);
  }

  replayNativeHandoff(): string {
    if (!this.#nativeLaunch || this.#lastHandoff === undefined)
      throw new Error('Native fixture handoff unavailable');
    return this.#nativeLaunch(this.#lastHandoff);
  }

  pendNextNativeCall(): void {
    this.#pendingNext = true;
  }

  rejectPendingNativeCall(): void {
    if (!this.#pendingReject) throw new Error('Native fixture call is not pending');
    const reject = this.#pendingReject;
    this.#pendingReject = undefined;
    reject(new Error('Native fixture pending call rejected'));
  }

  async launch(handoff: unknown): Promise<never> {
    if (!this.#nativeLaunch) throw new Error('Native fixture launcher was not composed');
    this.#lastHandoff = handoff;
    if (this.#pendingNext) {
      this.#pendingNext = false;
      return await new Promise<never>((_resolve, reject) => {
        this.#pendingReject = reject;
      });
    }
    this.evidence = JSON.parse(this.#nativeLaunch(handoff)) as NativeEvidence;
    throw new NativeFixtureCompleted('Native fixture completed');
  }
}

describeLinux('Linux native supervisor evidence helper', () => {
  let ownedRoot: string;
  let helper: string;
  let fixture: string;
  let fixtureDigest: string;
  let addon: NativeSupervisorAddon;

  const compile = (source: string, output: string) => {
    const compilation = spawnSync(
      'cc',
      [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-D_FORTIFY_SOURCE=2',
        '-fstack-protector-strong',
        '-fPIE',
        '-pie',
        '-Wl,-z,relro,-z,now',
        source,
        '-o',
        output,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
  };

  const compileAddon = (source: string, output: string) => {
    const nodeInclude = resolve(dirname(process.execPath), '..', 'include', 'node');
    const compilation = spawnSync(
      'cc',
      [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-D_FORTIFY_SOURCE=2',
        '-DNODE_GYP_MODULE_NAME=native_supervisor_addon',
        '-fstack-protector-strong',
        '-fPIC',
        '-shared',
        '-I',
        nodeInclude,
        source,
        '-o',
        output,
        '-Wl,-z,relro,-z,now',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
  };

  const createWorktree = (name: string): string => {
    const root = join(ownedRoot, name);
    const work = join(root, 'work');
    mkdirSync(work, { recursive: true, mode: 0o700 });
    writeFileSync(join(work, 'fixture.marker'), 'trusted', { mode: 0o600 });
    return root;
  };

  const run = (
    executable: string,
    root: string,
    digest: string,
    mode: 'normal' | 'tamper-after-copy' | 'replace-after-copy' = 'normal',
    expiresAt = Date.now() + 60_000,
  ) => {
    const metadata = statSync(executable, { bigint: true });
    return spawnSync(
      helper,
      [
        '--fixture',
        executable,
        '--root',
        root,
        '--sha256',
        digest,
        '--uid',
        metadata.uid.toString(),
        '--gid',
        metadata.gid.toString(),
        '--mode',
        (metadata.mode & 0o7777n).toString(),
        '--dev',
        metadata.dev.toString(),
        '--ino',
        metadata.ino.toString(),
        '--size',
        metadata.size.toString(),
        '--expires-at-ms',
        String(expiresAt),
        '--operation',
        mode,
      ],
      {
        encoding: 'utf8',
        env: {},
        timeout: 10_000,
      },
    );
  };

  const admission = (root: string) => {
    const metadata = statSync(fixture, { bigint: true });
    const ownerUid = Number(metadata.uid);
    const ownerGid = Number(metadata.gid);
    const executableMode = Number(metadata.mode & 0o777n);
    const observedNow = Date.now();
    const manifest: RuntimeLaunchManifest = {
      schemaVersion: 1,
      manifestId: 'native-linux-fixture-v1',
      manifestVersion: 1,
      workspaceId: 'workspace-native-fixture',
      runtimeId: 'runtime-native-fixture',
      connectionId: 'connection-native-fixture',
      adapterKind: 'DETERMINISTIC_FAKE',
      platform: 'LINUX',
      testOnly: true,
      executable: {
        canonicalPath: fixture,
        sha256: fixtureDigest,
        identityReference: `linux:dev-${metadata.dev.toString(16)}:ino-${metadata.ino.toString(16)}`,
      },
      argv: ['--mode', 'jsonl-fixture'],
      argumentPolicyReference: 'native-fixture-arguments-v1',
      worktreeRoot: root,
      workingDirectory: `${root}/work`,
      protocol: 'JSONL_STDIO',
      network: 'DENY',
      shell: false,
      environmentVariableNames: [],
      secretTransport: 'NONE',
      limits: {
        maximumRuntimeMs: 60_000,
        maximumMemoryBytes: 64 * 1_024 * 1_024,
        maximumCpuTimeMs: 2_000,
        maximumInputBytes: 1_024 * 1_024,
        maximumStdoutBytes: 1_024 * 1_024,
        maximumStderrBytes: 256 * 1_024,
        maximumChildProcesses: 0,
      },
      platformPolicy: {
        kind: 'LINUX',
        ownerUid,
        ownerGid,
        mode: executableMode,
        symbolicLink: false,
      },
    };
    const payload: LinuxExecutableAuthorizationPayload = {
      schemaVersion: 1,
      authorizationId: 'native-fixture-authorization-v1',
      authorizationVersion: 1,
      signerKeyId: 'ventureos-test-executable-authority-v1',
      validFrom: new Date(observedNow - 10_000).toISOString(),
      validUntil: new Date(observedNow + 240_000).toISOString(),
      adapterKind: manifest.adapterKind,
      testOnly: true,
      canonicalPath: manifest.executable.canonicalPath,
      sha256: manifest.executable.sha256,
      identityReference: manifest.executable.identityReference,
      ownerUid,
      ownerGid,
      mode: executableMode,
      authorizedWorktreeRoot: manifest.worktreeRoot,
      argumentPolicyReference: manifest.argumentPolicyReference,
    };
    const authorization: LinuxExecutableAuthorization = {
      ...payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)), TEST_SIGNER_PRIVATE_KEY).toString(
        'base64',
      ),
    };
    const evidence: TrustedSupervisorAdmissionEvidence = {
      schemaVersion: 2,
      evidenceId: 'native-fixture-evidence-v1',
      workspaceId: manifest.workspaceId,
      runtimeId: manifest.runtimeId,
      connectionId: manifest.connectionId,
      manifestId: manifest.manifestId,
      manifestVersion: manifest.manifestVersion,
      authorizedManifestHash: hash(manifest),
      adapterKind: manifest.adapterKind,
      platform: 'LINUX',
      testOnly: true,
      observedAt: new Date(observedNow - 5_000).toISOString(),
      expiresAt: new Date(observedNow + 60_000).toISOString(),
      canonicalPath: manifest.executable.canonicalPath,
      sha256: manifest.executable.sha256,
      identityReference: manifest.executable.identityReference,
      authorizedWorktreeRoot: manifest.worktreeRoot,
      argvHash: hash(manifest.argv),
      argumentPolicyReference: manifest.argumentPolicyReference,
      authorizationId: authorization.authorizationId,
      authorizationVersion: authorization.authorizationVersion,
      authorizationHash: linuxExecutableAuthorizationHash(authorization),
      authorizationSignerKeyId: authorization.signerKeyId,
      authorizationValidFrom: authorization.validFrom,
      authorizationValidUntil: authorization.validUntil,
      authorizationSignature: authorization.signature,
      fileKind: 'REGULAR',
      platformEvidence: manifest.platformPolicy,
    };
    return { authorization, evidence, manifest };
  };

  beforeAll(() => {
    const compiler = spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 });
    expect(compiler.status, 'Authoritative Linux CI must provide cc').toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-native-supervisor-'));
    helper = join(ownedRoot, 'native-supervisor-helper');
    fixture = join(ownedRoot, 'native-runtime-fixture');
    compile(join(nativeSourceRoot, 'native-supervisor-helper.c'), helper);
    compile(join(nativeSourceRoot, 'native-runtime-fixture.c'), fixture);
    chmodSync(fixture, 0o500);
    const addonPath = join(ownedRoot, 'native-supervisor-addon.node');
    compileAddon(join(nativeSourceRoot, 'native-supervisor-addon.c'), addonPath);
    addon = nativeRequire(addonPath) as NativeSupervisorAddon;
    fixtureDigest = createHash('sha256').update(readFileSync(fixture)).digest('hex');
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  it('consumes the composition-owned permit before the test-only native handoff', async () => {
    const fixtureAdmission = admission(createWorktree('success'));
    const launcher = new NativeExecveatRuntimeProcessLauncher(
      addon,
      fixtureAdmission.manifest,
      statSync(fixture, { bigint: true }).size,
    );
    const composition = new TrustedSupervisorComposition(
      new NativeAuthorizationSource(fixtureAdmission.authorization),
      new NativeEvidenceReader(fixtureAdmission.evidence),
      launcher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare({
      schemaVersion: 1,
      manifest: fixtureAdmission.manifest,
    });
    const nativeMetadata = statSync(fixture, { bigint: true });
    const validNativeStrings = [
      fixtureAdmission.manifest.executable.canonicalPath,
      fixtureAdmission.manifest.worktreeRoot,
      fixtureAdmission.manifest.executable.sha256,
      nativeMetadata.uid.toString(),
      nativeMetadata.gid.toString(),
      (nativeMetadata.mode & 0o7777n).toString(),
      nativeMetadata.dev.toString(),
      nativeMetadata.ino.toString(),
      nativeMetadata.size.toString(),
      String(Date.parse(plan.expiresAt)),
    ];

    expect(() => addon.bind(() => validNativeStrings)).toThrow('Native fixture invocation denied');
    expect(() => launcher.directNativeCall(...validNativeStrings)).toThrow(
      'Native fixture invocation denied',
    );

    await expect(launcher.launch(plan.launchRequest)).rejects.toMatchObject({
      code: 'NATIVE_DENIED',
      message: 'Native fixture invocation denied',
    });
    await expect(launcher.launch({ ...plan.launchRequest })).rejects.toMatchObject({
      code: 'NATIVE_DENIED',
      message: 'Native fixture invocation denied',
    });
    expect(launcher.calls).toBe(0);

    await expect(composition.execute(plan)).rejects.toBeInstanceOf(NativeFixtureCompleted);
    expect(launcher.calls).toBe(1);
    expect(launcher.evidence).toEqual({
      schemaVersion: 1,
      sourceDigest: fixtureDigest,
      sealedDigest: fixtureDigest,
      execveatSucceeded: true,
      emptyEnvironment: true,
      noNewPrivileges: true,
      resourceLimitsVerified: true,
      socketDeniedBySeccomp: true,
      childCreationDeniedBySeccomp: true,
      sessionEscapeDeniedBySeccomp: true,
      retainedWorkingDirectoryVerified: true,
      termEscalatedToKill: true,
      pidfdObservedExit: true,
      processGroupGone: true,
    });
    expect(() => launcher.replayNativeHandoff()).toThrow('Native fixture invocation denied');
    expect(launcher.calls).toBe(1);

    const expiringPlan = await composition.prepare({
      schemaVersion: 1,
      manifest: fixtureAdmission.manifest,
    });
    launcher.pendNextNativeCall();
    const pendingExecution = composition.execute(expiringPlan);
    const pendingDenial = expect(pendingExecution).rejects.toThrow(
      'Native fixture pending call rejected',
    );
    await Promise.resolve();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expiringPlan.expiresAt));
    expect(() => launcher.replayNativeHandoff()).toThrow('Native fixture invocation denied');
    expect(launcher.calls).toBe(1);
    launcher.rejectPendingNativeCall();
    await pendingDenial;
    vi.restoreAllMocks();

    await expect(composition.execute(plan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(launcher.calls).toBe(1);
  });

  it('denies expired and argv-drifted plans before the native launcher', async () => {
    const fixtureAdmission = admission(createWorktree('permit-denial'));
    const launcher = new NeverCalledLauncher();
    const composition = new TrustedSupervisorComposition(
      new NativeAuthorizationSource(fixtureAdmission.authorization),
      new NativeEvidenceReader(fixtureAdmission.evidence),
      launcher.factory(),
      new TestOnlyLinuxExecutableAuthorizationVerifier(),
    );
    const plan = await composition.prepare({
      schemaVersion: 1,
      manifest: fixtureAdmission.manifest,
    });
    for (const deniedPlan of [
      { ...plan },
      {
        ...plan,
        launchRequest: {
          ...plan.launchRequest,
          manifest: {
            ...plan.launchRequest.manifest,
            argv: ['--mode', 'jsonl-fixture', '--inserted'],
          },
        },
      },
      {
        ...plan,
        launchRequest: {
          ...plan.launchRequest,
          manifest: { ...plan.launchRequest.manifest, argv: ['jsonl-fixture', '--mode'] },
        },
      },
    ]) {
      await expect(composition.execute(deniedPlan)).rejects.toMatchObject({
        code: 'AUTHORIZATION_DENIED',
      });
      expect(launcher.calls).toBe(0);
    }

    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(plan.expiresAt));
    await expect(composition.execute(plan)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(launcher.calls).toBe(0);
  });

  it('fails closed for symlink, digest, metadata, ELF, exec, size, and worktree drift', () => {
    const symlinkFixture = join(ownedRoot, 'fixture-link');
    symlinkSync(fixture, symlinkFixture);
    expect(run(symlinkFixture, createWorktree('symlink'), fixtureDigest)).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:SOURCE_OPEN\n',
    });

    const fifoFixture = join(ownedRoot, 'fifo-fixture');
    expect(spawnSync('mkfifo', [fifoFixture], { encoding: 'utf8' }).status).toBe(0);
    expect(run(fifoFixture, createWorktree('fifo'), fixtureDigest)).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:SOURCE_METADATA\n',
    });

    expect(run(fixture, createWorktree('digest'), '0'.repeat(64))).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:DIGEST_MISMATCH\n',
    });

    const ownerWritable = join(ownedRoot, 'owner-writable-fixture');
    copyFileSync(fixture, ownerWritable);
    chmodSync(ownerWritable, 0o700);
    expect(run(ownerWritable, createWorktree('owner-writable'), fixtureDigest)).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:SOURCE_METADATA\n',
    });

    const tampered = join(ownedRoot, 'tampered-fixture');
    copyFileSync(fixture, tampered);
    chmodSync(tampered, 0o500);
    expect(
      run(tampered, createWorktree('tamper'), fixtureDigest, 'tamper-after-copy'),
    ).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:METADATA_REVALIDATION\n',
    });

    const replaced = join(ownedRoot, 'replaced-fixture');
    const replacement = `${replaced}.replacement`;
    copyFileSync(fixture, replaced);
    copyFileSync(fixture, replacement);
    chmodSync(replaced, 0o500);
    chmodSync(replacement, 0o500);
    expect(
      run(replaced, createWorktree('replace'), fixtureDigest, 'replace-after-copy'),
    ).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:METADATA_REVALIDATION\n',
    });

    const fifoReplaced = join(ownedRoot, 'fifo-replaced-fixture');
    copyFileSync(fixture, fifoReplaced);
    chmodSync(fifoReplaced, 0o500);
    expect(spawnSync('mkfifo', [`${fifoReplaced}.replacement`], { encoding: 'utf8' }).status).toBe(
      0,
    );
    expect(
      run(fifoReplaced, createWorktree('fifo-replace'), fixtureDigest, 'replace-after-copy'),
    ).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:METADATA_REVALIDATION\n',
    });

    const notElf = join(ownedRoot, 'not-elf');
    writeFileSync(notElf, 'not an executable', { mode: 0o500 });
    const notElfDigest = createHash('sha256').update('not an executable').digest('hex');
    expect(run(notElf, createWorktree('not-elf-worktree'), notElfDigest)).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:ELF_REQUIRED\n',
    });

    const malformedElf = join(ownedRoot, 'malformed-elf');
    const malformedBytes = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]);
    writeFileSync(malformedElf, malformedBytes, { mode: 0o500 });
    const malformedDigest = createHash('sha256').update(malformedBytes).digest('hex');
    const malformedResult = run(malformedElf, createWorktree('malformed'), malformedDigest);
    expect(malformedResult).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:EXECVEAT_STATUS\n',
    });

    const oversized = join(ownedRoot, 'oversized-elf');
    const oversizedBytes = Buffer.alloc(1024 * 1024 + 1);
    oversizedBytes.set([0x7f, 0x45, 0x4c, 0x46]);
    writeFileSync(oversized, oversizedBytes, { mode: 0o500 });
    const oversizedDigest = createHash('sha256').update(oversizedBytes).digest('hex');
    expect(run(oversized, createWorktree('oversized'), oversizedDigest)).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:METADATA_INPUT\n',
    });

    const symlinkRoot = join(ownedRoot, 'symlink-root');
    const outside = join(ownedRoot, 'outside-work');
    mkdirSync(symlinkRoot, { mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(join(outside, 'fixture.marker'), 'trusted', { mode: 0o600 });
    symlinkSync(outside, join(symlinkRoot, 'work'));
    expect(run(fixture, symlinkRoot, fixtureDigest)).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:WORKDIR_METADATA\n',
    });

    const expiredRoot = createWorktree('expired-native');
    expect(run(fixture, expiredRoot, fixtureDigest, 'normal', Date.now() - 1)).toMatchObject({
      status: 70,
      stdout: '',
      stderr: 'NATIVE_SUPERVISOR_DENIED:PERMIT_EXPIRED\n',
    });
    expect(readFileSync(join(expiredRoot, 'work', 'fixture.marker'), 'utf8')).toBe('trusted');
  });
});
