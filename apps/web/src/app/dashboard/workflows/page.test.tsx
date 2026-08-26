import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowCentreSnapshot } from '@/lib/workflow-centre';

const { serverApiFetchMock } = vi.hoisted(() => ({ serverApiFetchMock: vi.fn() }));
vi.mock('@/lib/server-api', () => ({ serverApiFetch: serverApiFetchMock }));
vi.stubGlobal('React', React);

import WorkflowCentrePage from './page';

function snapshot(): WorkflowCentreSnapshot {
  return {
    schemaVersion: 1,
    observedAt: '2026-08-26T06:30:00.000Z',
    access: { permission: 'workflow:view', mode: 'READ_ONLY' },
    connectivity: {
      status: 'NOT_CONFIGURED',
      targets: ['CODEX', 'HERMES', 'PI'],
      reasonCode: 'NO_AUTHENTICATED_DIRECT_ADAPTER',
    },
    summary: {
      workflowRuns: 1,
      objectives: 1,
      tasks: 1,
      runs: 1,
      activeRuns: 1,
      runtimes: 1,
      connections: 1,
      pendingLevel4Approvals: 1,
    },
    bounds: {
      workflowRuns: { total: 1, returned: 1, truncated: false },
      objectives: { total: 1, returned: 1, truncated: false },
      tasks: { total: 1, returned: 1, truncated: false },
      dependencies: { total: 0, returned: 0, truncated: false },
      runs: { total: 1, returned: 1, truncated: false },
      runtimes: { total: 1, returned: 1, truncated: false },
      connections: { total: 1, returned: 1, truncated: false },
      pendingApprovals: { total: 1, returned: 1, truncated: false },
      stepsPerWorkflow: 20,
    },
    workflows: [
      {
        id: 'workflow-1',
        type: '<img src=x onerror=globalThis.compromised=true>',
        status: 'RUNNING',
        correlationId: 'correlation-1',
        startedAt: '2026-08-26T06:00:00.000Z',
        completedAt: null,
        stepsTruncated: false,
        steps: [],
      },
    ],
    objectives: [
      {
        id: 'objective-1',
        title: 'Objective one',
        status: 'ACTIVE',
        maximumAuthority: 4,
        version: 1,
        createdAt: '2026-08-26T06:00:00.000Z',
        updatedAt: '2026-08-26T06:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'task-1',
        objectiveId: 'objective-1',
        projectId: 'project-1',
        title: '<script>globalThis.compromised=true</script>',
        kind: 'QUALITY.VERIFY',
        status: 'AWAITING_APPROVAL',
        requiredAuthority: 4,
        assignment: { agentId: null, runtimeId: null, connectionId: null },
        attempt: 0,
        version: 1,
        createdAt: '2026-08-26T06:00:00.000Z',
        updatedAt: '2026-08-26T06:00:00.000Z',
        completedAt: null,
      },
    ],
    dependencies: [],
    runs: [
      {
        id: 'run-1',
        objectiveId: 'objective-1',
        taskId: 'task-1',
        status: 'AWAITING_APPROVAL',
        requiredAuthority: 4,
        assignment: { agentId: null, runtimeId: null, connectionId: null },
        attempt: 0,
        version: 1,
        createdAt: '2026-08-26T06:00:00.000Z',
        updatedAt: '2026-08-26T06:00:00.000Z',
        startedAt: null,
        completedAt: null,
      },
    ],
    runtimes: [
      {
        id: 'generic-runtime-1',
        adapterKind: 'PROTOCOL_NEUTRAL',
        status: 'PARTIAL',
        version: 1,
        updatedAt: '2026-08-26T06:00:00.000Z',
      },
    ],
    connections: [
      {
        id: 'connection-1',
        runtimeId: 'generic-runtime-1',
        environment: 'TEST_ONLY',
        status: 'PARTIAL',
        lastHeartbeatAt: null,
        lastHeartbeatHealth: null,
        version: 1,
        updatedAt: '2026-08-26T06:00:00.000Z',
      },
    ],
    pendingLevel4Approvals: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        objectiveId: 'objective-1',
        taskId: 'task-1',
        runId: 'run-1',
        actionCode: 'RELEASE.PREPARE',
        state: 'PENDING',
        expiresAt: '2026-08-26T07:00:00.000Z',
        createdAt: '2026-08-26T06:00:00.000Z',
      },
    ],
  };
}

describe('Workflow Centre dashboard', () => {
  beforeEach(() => serverApiFetchMock.mockReset());

  it('renders persisted status and escapes untrusted display strings without authority controls', async () => {
    serverApiFetchMock.mockResolvedValue({ data: snapshot(), status: 200 });
    const html = renderToStaticMarkup(await WorkflowCentrePage());

    expect(html).toContain('Workflow Centre');
    expect(html).toContain('Codex, Hermes and Pi: NOT_CONFIGURED');
    expect(html).toContain('&lt;script&gt;globalThis.compromised=true&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=globalThis.compromised=true&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Approve');
    expect(html).not.toContain('Reject');
  });

  it('distinguishes permission denial from an empty workspace', async () => {
    serverApiFetchMock.mockResolvedValue({ data: null, status: 403 });
    const denied = renderToStaticMarkup(await WorkflowCentrePage());
    expect(denied).toContain('Workflow access unavailable');
    expect(denied).toContain('workflow:view');
    expect(denied).not.toContain('No workflow activity yet');

    const empty = snapshot();
    empty.summary = {
      workflowRuns: 0,
      objectives: 0,
      tasks: 0,
      runs: 0,
      activeRuns: 0,
      runtimes: 0,
      connections: 0,
      pendingLevel4Approvals: 0,
    };
    empty.workflows = [];
    empty.objectives = [];
    empty.tasks = [];
    empty.runs = [];
    empty.runtimes = [];
    empty.connections = [];
    empty.pendingLevel4Approvals = [];
    serverApiFetchMock.mockResolvedValue({ data: empty, status: 200 });
    const zero = renderToStaticMarkup(await WorkflowCentrePage());
    expect(zero).toContain('No workflow activity yet');
    expect(zero).toContain('NOT_CONFIGURED');
  });

  it('reports service failure as unavailable rather than as a verified zero state', async () => {
    serverApiFetchMock.mockResolvedValue({ data: null, status: 500 });
    const html = renderToStaticMarkup(await WorkflowCentrePage());
    expect(html).toContain('Workflow data unavailable');
    expect(html).not.toContain('No workflow activity yet');
  });
});
