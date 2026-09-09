/** Public capability summary. This is source content, never live runtime telemetry. */
export const BUILD_STATUS = {
  label: 'Implementation summary · not live telemetry',
  boundary:
    'Implemented capabilities include mock-provider rehearsals. Runtime connections, deployment and commercial outcomes require separate verified evidence.',
  runtime: 'NOT_CONFIGURED',
  milestones: [
    {
      title: 'Foundation & governance',
      detail: 'Identity, workspace isolation, permissions and audit controls',
      status: 'Implemented',
      tone: 'complete',
    },
    {
      title: 'Opportunity intelligence',
      detail: 'Evidence intake, provenance, scoring and freshness controls',
      status: 'Implemented',
      tone: 'complete',
    },
    {
      title: 'Board & founder approvals',
      detail: 'Board review, deterministic policy and persisted approval gates',
      status: 'Implemented',
      tone: 'complete',
    },
    {
      title: 'Product & listing studio',
      detail: 'Product preparation, quality review and mock marketplace workflows',
      status: 'Implemented',
      tone: 'complete',
    },
    {
      title: 'Finance & outcome evidence',
      detail: 'Forecasts, bounded costs and explicitly unverified commercial evidence',
      status: 'Implemented',
      tone: 'complete',
    },
    {
      title: 'Runtime & staging acceptance',
      detail: 'Authenticated runtime round trip and exact-release operational verification',
      status: 'Not verified',
      tone: 'progress',
    },
    {
      title: 'Real commercial pilot',
      detail: 'Verified delivery, payment, costs and a founder-reviewed outcome',
      status: 'Not verified',
      tone: 'progress',
    },
    {
      title: 'Production launch',
      detail: 'Security, operational readiness and explicit founder release approval',
      status: 'Gated',
      tone: 'locked',
    },
  ],
} as const;
