import { describe, expect, it } from 'vitest';

import { deterministicLinuxAdmission } from './__tests__/fixtures/deterministic-supervision';
import {
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_APP_SERVER_ARGUMENT_POLICY,
  CODEX_APP_SERVER_ARGV,
  validateCodexAppServerManifest,
} from './codex-app-server-policy';
import type { RuntimeLaunchManifest } from './supervision-policy';

function candidate(): RuntimeLaunchManifest {
  const fixture = deterministicLinuxAdmission().manifest;
  return {
    ...fixture,
    manifestId: 'codex-app-server-manifest-v1',
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
    testOnly: false,
    executable: {
      canonicalPath: '/opt/ventureos/runtimes/codex/codex',
      sha256: '8'.repeat(64),
      identityReference: 'device-8:inode-12',
    },
    argv: [...CODEX_APP_SERVER_ARGV],
    argumentPolicyReference: CODEX_APP_SERVER_ARGUMENT_POLICY,
    secretTransport: 'NONE',
  };
}

const clone = <T>(value: T): T => structuredClone(value);

describe('Codex app-server adapter policy', () => {
  it('validates one inert Linux stdio manifest with stable policy evidence', () => {
    const manifest = candidate();
    const first = validateCodexAppServerManifest(manifest);
    const second = validateCodexAppServerManifest(clone(manifest));

    expect(second).toEqual(first);
    expect(first.manifest.argv).toEqual(['app-server', '--listen', 'stdio://']);
    expect(first.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.argvHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.adapterPolicyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.launchAuthorization).toBe('NOT_CONFIGURED');
    expect(first.providerAccess).toBe('NOT_CONFIGURED');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.manifest.argv)).toBe(true);
    expect(first).not.toHaveProperty('launch');
    expect(first).not.toHaveProperty('execute');

    (manifest.argv as string[])[0] = 'other';
    expect(first.manifest.argv).toEqual(['app-server', '--listen', 'stdio://']);
  });

  it.each([
    ['adapterKind', 'PROTOCOL_NEUTRAL', 'ADAPTER_MISMATCH'],
    ['argumentPolicyReference', 'ventureos.codex-app-server.other.v1', 'ARGUMENT_POLICY_MISMATCH'],
    ['secretTransport', 'INHERITED_HANDLE', 'SECRET_TRANSPORT_DENIED'],
  ] as const)('rejects adapter authority drift in %s', (field, value, code) => {
    const manifest = candidate();
    (manifest as unknown as Record<string, unknown>)[field] = value;
    expect(() => validateCodexAppServerManifest(manifest)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    ['codex-wrapper', 'EXECUTABLE_MISMATCH'],
    ['Codex', 'EXECUTABLE_MISMATCH'],
    ['codex.exe', 'EXECUTABLE_MISMATCH'],
  ] as const)('rejects alternate executable basename %s', (basename, code) => {
    const manifest = candidate();
    (manifest.executable as { canonicalPath: string }).canonicalPath =
      `/opt/ventureos/runtimes/codex/${basename}`;
    expect(() => validateCodexAppServerManifest(manifest)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  const rejectedArguments: readonly (readonly string[])[] = [
    [],
    ['app-server'],
    ['app-server', '--listen', 'ws://127.0.0.1:4500'],
    ['app-server', '--listen', 'unix://'],
    ['app-server', '--code-mode-host', 'wss://code-mode.example.com/host'],
    ['app-server', '--listen', 'stdio://', '--experimental'],
    ['exec', '--json'],
  ];

  it.each(rejectedArguments.map((argv) => [argv] as const))(
    'rejects non-reviewed arguments %j',
    (argv) => {
      const manifest = candidate();
      (manifest as { argv: readonly string[] }).argv = argv;
      expect(() => validateCodexAppServerManifest(manifest)).toThrow(
        expect.objectContaining({ code: 'ARGUMENT_MISMATCH' }),
      );
    },
  );

  it('rejects Windows and test-only candidates before they can become adapter authority', () => {
    const windows = candidate();
    (windows as unknown as Record<string, unknown>).platform = 'WIN32';
    (windows as unknown as Record<string, unknown>).executable = {
      ...windows.executable,
      canonicalPath: 'C:\\VentureOS\\Runtimes\\codex.exe',
      identityReference: 'volume-8:file-12',
    };
    (windows as unknown as Record<string, unknown>).worktreeRoot = 'C:\\VentureOS\\Worktrees';
    (windows as unknown as Record<string, unknown>).workingDirectory =
      'C:\\VentureOS\\Worktrees\\task-one';
    (windows as unknown as Record<string, unknown>).platformPolicy = {
      kind: 'WIN32',
      ownerReference: 'ventureos-runtime-owner',
      reparsePoint: false,
    };
    expect(() => validateCodexAppServerManifest(windows)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_PLATFORM' }),
    );

    const testOnly = candidate();
    (testOnly as unknown as Record<string, unknown>).testOnly = true;
    expect(() => validateCodexAppServerManifest(testOnly)).toThrow(
      expect.objectContaining({ code: 'INVALID_MANIFEST' }),
    );
  });

  it('inherits the deny-by-default environment, network, shell, path, and limit policy', () => {
    const mutations: Array<(manifest: RuntimeLaunchManifest) => void> = [
      (manifest) => {
        (manifest as unknown as Record<string, unknown>).network = 'ALLOW';
      },
      (manifest) => {
        (manifest as unknown as Record<string, unknown>).shell = true;
      },
      (manifest) => {
        (manifest as unknown as Record<string, unknown>).environmentVariableNames = ['CODEX_HOME'];
      },
      (manifest) => {
        (manifest as unknown as Record<string, unknown>).workingDirectory = '/workspaces/escape';
      },
      (manifest) => {
        (manifest.limits as unknown as Record<string, unknown>).maximumChildProcesses = 1;
      },
    ];
    for (const mutate of mutations) {
      const manifest = candidate();
      mutate(manifest);
      expect(() => validateCodexAppServerManifest(manifest)).toThrow(
        expect.objectContaining({ code: 'INVALID_MANIFEST' }),
      );
    }
  });
});
