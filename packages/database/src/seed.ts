/**
 * VentureOS Phase 1 seed script.
 * Creates: founder user, founder role + permissions, founder workspace,
 * workspace membership, founder profile, and mock/disconnected integration
 * records (MinIO, Etsy mock, AI mock). Idempotent: safe to re-run.
 *
 * Run with: pnpm db:seed  (requires DATABASE_URL pointing at a real Postgres
 * instance and prior `pnpm db:generate` + `pnpm db:migrate:dev`.)
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { prisma } from './client.js';
import { hashContent } from '@ventureos/security';
import {
  calculateOpportunityScore,
  calculateProfitConfidenceScore,
} from '@ventureos/scoring-engine';
import { DEFAULT_AGENT_WEIGHTS } from '@ventureos/policy-engine';
import { BOARD_AGENT_ROLES } from '@ventureos/contracts';
import { resolveSeedFounderCredentials } from './seed-credentials.js';

// Phase 8: mirrors packages/billing/src/plans.ts's DEFAULT_PLANS exactly,
// duplicated here rather than imported because @ventureos/database cannot
// depend on @ventureos/billing (billing already depends on
// @ventureos/database for its Prisma client -- that would be a circular
// workspace dependency, the same reason Phase 4's Etsy policy pack literal
// is duplicated rather than imported). Keep the two literals in sync by hand
// if the plan definitions ever change.
const DEFAULT_PLANS = [
  {
    key: 'TRIAL',
    name: 'Trial',
    description: '14-day trial, full feature access, single venture.',
    priceMonthlyEur: 0,
    maxVentures: 1,
    maxWorkspaceMembers: 1,
    maxMarketplaceAccounts: 1,
    features: ['opportunities', 'board', 'products', 'finance'],
  },
  {
    key: 'STARTER',
    name: 'Starter',
    description: 'For a single founder running a handful of ventures.',
    priceMonthlyEur: 29,
    maxVentures: 3,
    maxWorkspaceMembers: 2,
    maxMarketplaceAccounts: 1,
    features: ['opportunities', 'board', 'products', 'finance'],
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    description: 'For a small team running several concurrent ventures.',
    priceMonthlyEur: 99,
    maxVentures: 10,
    maxWorkspaceMembers: 5,
    maxMarketplaceAccounts: 3,
    features: ['opportunities', 'board', 'products', 'finance', 'white_label'],
  },
  {
    key: 'AGENCY',
    name: 'Agency',
    description: 'For an agency reselling VentureOS to its own clients.',
    priceMonthlyEur: 299,
    maxVentures: 50,
    maxWorkspaceMembers: 20,
    maxMarketplaceAccounts: 10,
    features: ['opportunities', 'board', 'products', 'finance', 'white_label', 'license_export'],
  },
];
const DEFAULT_TRIAL_LENGTH_DAYS = 14;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

const PERMISSIONS = [
  { key: 'workspace:manage', description: 'Manage workspace settings' },
  {
    key: 'workspace:members:manage',
    description: 'Invite, change roles, and remove workspace members',
  },
  { key: 'approval:decide', description: 'Approve, reject or revise approval requests' },
  { key: 'approval:view', description: 'View approval requests' },
  { key: 'audit:view', description: 'View audit and security events' },
  { key: 'product:publish', description: 'Approve product/listing publication' },
  { key: 'integration:manage', description: 'Connect/disconnect integrations' },
  { key: 'workflow:view', description: 'View workflow runs' },
  { key: 'opportunity:view', description: 'View the opportunity feed and evidence' },
  { key: 'opportunity:manage', description: 'Reject, archive, or promote opportunities' },
  { key: 'board:view', description: 'View board reviews, votes, vetoes, and decision summaries' },
  { key: 'board:manage', description: 'Trigger a board review run for a venture proposal' },
  {
    key: 'product:view',
    description: 'View generated products, listings, QA checks, and licence records',
  },
  {
    key: 'product:manage',
    description: 'Trigger product + listing generation for an approved venture proposal',
  },
  {
    key: 'research:view',
    description: 'View data acquisition contracts, run history, and resulting evidence',
  },
  {
    key: 'research:manage',
    description: 'Trigger a research connector acquisition run',
  },
  {
    key: 'marketplace:view',
    description: 'View marketplace publication status, attempts, and approvals',
  },
  {
    key: 'marketplace:manage',
    description: 'Prepare, request approval for, and publish a listing (mock adapter, Phase 6)',
  },
  {
    key: 'finance:view',
    description: 'View finance assumptions, forecasts, expenses, revenue, budgets, and experiments',
  },
  {
    key: 'finance:manage',
    description:
      'Edit finance assumptions, generate forecasts, record expenses/revenue, manage budgets, and run experiments (Phase 7)',
  },
  {
    key: 'billing:view',
    description: 'View the workspace subscription, plan limits, usage, and license keys (Phase 8)',
  },
  {
    key: 'billing:manage',
    description:
      'Change plan, cancel/reactivate the subscription, and issue/revoke license keys (Phase 8)',
  },
  {
    key: 'workspace:branding:manage',
    description:
      'Edit white-label branding (brand name, logo, accent color, terminology) (Phase 8)',
  },
];

async function main() {
  // Validate the complete seed safety boundary before the first database read
  // or write. Missing, placeholder, or production credentials must leave the
  // target database untouched.
  const { email: founderEmail, password: founderPassword } = resolveSeedFounderCredentials();

  console.log('[seed] starting VentureOS Phase 1 seed...');

  // --- Permissions (idempotent upsert) ---
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description },
      create: { key: perm.key, description: perm.description },
    });
  }

  // --- Founder role with all permissions ---
  const founderRole = await prisma.role.upsert({
    where: { key: 'FOUNDER' },
    update: {},
    create: { key: 'FOUNDER', name: 'Founder', description: 'Full authority workspace owner' },
  });

  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: founderRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: founderRole.id, permissionId: perm.id },
    });
  }

  const operatorRole = await prisma.role.upsert({
    where: { key: 'OPERATOR' },
    update: {
      name: 'Operator',
      description: 'Operate workspace workflows without founder-only authority',
    },
    create: {
      key: 'OPERATOR',
      name: 'Operator',
      description: 'Operate workspace workflows without founder-only authority',
    },
  });

  const viewerRole = await prisma.role.upsert({
    where: { key: 'VIEWER' },
    update: { name: 'Viewer', description: 'Read-only workspace access' },
    create: { key: 'VIEWER', name: 'Viewer', description: 'Read-only access' },
  });

  const collaboratorViewPermissionKeys = [
    'approval:view',
    'workflow:view',
    'opportunity:view',
    'board:view',
    'product:view',
    'research:view',
    'marketplace:view',
    'finance:view',
  ];
  const operatorPermissionKeys = new Set([
    ...collaboratorViewPermissionKeys,
    'opportunity:manage',
    'board:manage',
    'product:manage',
    'research:manage',
    'marketplace:manage',
    'finance:manage',
  ]);
  const viewerPermissionKeys = new Set(collaboratorViewPermissionKeys);

  await prisma.rolePermission.deleteMany({
    where: { roleId: { in: [operatorRole.id, viewerRole.id] } },
  });
  await prisma.rolePermission.createMany({
    data: allPermissions.flatMap((permission) => [
      ...(operatorPermissionKeys.has(permission.key)
        ? [{ roleId: operatorRole.id, permissionId: permission.id }]
        : []),
      ...(viewerPermissionKeys.has(permission.key)
        ? [{ roleId: viewerRole.id, permissionId: permission.id }]
        : []),
    ]),
    skipDuplicates: true,
  });

  // --- Founder user (explicit non-placeholder env credentials only) ---
  const founderUser = await prisma.user.upsert({
    where: { email: founderEmail },
    update: {},
    create: {
      email: founderEmail,
      passwordHash: hashPassword(founderPassword),
      displayName: 'Yiannis',
      isFounder: true,
    },
  });

  await prisma.founderProfile.upsert({
    where: { userId: founderUser.id },
    update: {},
    create: { userId: founderUser.id },
  });

  // --- Founder workspace ---
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'ventureos-default' },
    update: {},
    create: {
      name: 'VentureOS',
      slug: 'ventureos-default',
      mode: 'SINGLE_FOUNDER',
      baseCurrency: 'EUR',
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: founderUser.id } },
    update: { roleId: founderRole.id },
    create: { workspaceId: workspace.id, userId: founderUser.id, roleId: founderRole.id },
  });

  // --- Development integration records (all mock / disconnected by default) ---
  const integrations: Array<{ provider: string; mode: string }> = [
    { provider: 'minio', mode: 'READ_ONLY' },
    { provider: 'etsy', mode: 'MOCK' },
    { provider: 'ai-mock', mode: 'MOCK' },
  ];
  for (const integ of integrations) {
    await prisma.integration.upsert({
      where: { workspaceId_provider: { workspaceId: workspace.id, provider: integ.provider } },
      update: {},
      create: {
        workspaceId: workspace.id,
        provider: integ.provider,
        mode: integ.mode,
        writeEnabled: false,
        status: 'DISCONNECTED',
      },
    });
  }

  // --- Phase 3: the 8 voting board agents + the non-voting Decision
  // Synthesiser (master spec section 11). Weights/veto mapping mirror the
  // already-unit-tested constants in @ventureos/policy-engine exactly, so
  // the persisted rows can never silently drift from the voting math. ---
  const AGENT_DEFINITIONS: Array<{
    role: string;
    name: string;
    isVoting: boolean;
    weight: number | null;
    responsibilities: string[];
    toolAllowlist: string[];
    prohibitedActions: string[];
  }> = [
    {
      role: 'MARKET_INTELLIGENCE_DIRECTOR',
      name: 'Market Intelligence Director',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.MARKET_INTELLIGENCE_DIRECTOR,
      responsibilities: [
        'Assess demand, trend strength, and competitive landscape for the opportunity',
      ],
      toolAllowlist: ['read:opportunity', 'read:evidence'],
      prohibitedActions: ['write:opportunity', 'external:publish'],
    },
    {
      role: 'PRODUCT_STRATEGY_DIRECTOR',
      name: 'Product Strategy Director',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.PRODUCT_STRATEGY_DIRECTOR,
      responsibilities: ['Evaluate product/marketplace fit and differentiation'],
      toolAllowlist: ['read:opportunity', 'read:evidence'],
      prohibitedActions: ['write:opportunity', 'external:publish'],
    },
    {
      role: 'CREATIVE_AND_PRODUCTION_DIRECTOR',
      name: 'Creative and Production Director',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.CREATIVE_AND_PRODUCTION_DIRECTOR,
      responsibilities: ['Assess production feasibility and creative scope'],
      toolAllowlist: ['read:opportunity'],
      prohibitedActions: ['write:opportunity', 'external:publish'],
    },
    {
      role: 'FINANCE_AND_RISK_OFFICER',
      name: 'Finance and Risk Officer',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.FINANCE_AND_RISK_OFFICER,
      responsibilities: [
        'Evaluate profit confidence, cost estimates, and financial risk; holds a critical FINANCE veto',
      ],
      toolAllowlist: ['read:opportunity', 'read:evidence', 'read:financials'],
      prohibitedActions: ['write:opportunity', 'external:publish', 'execute:payment'],
    },
    {
      role: 'GROWTH_DIRECTOR',
      name: 'Growth Director',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.GROWTH_DIRECTOR,
      responsibilities: ['Evaluate channel and growth potential'],
      toolAllowlist: ['read:opportunity'],
      prohibitedActions: ['write:opportunity', 'external:publish'],
    },
    {
      role: 'COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER',
      name: 'Compliance and Marketplace Policy Officer',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER,
      responsibilities: [
        'Evaluate marketplace policy and IP/compliance risk; holds a critical COMPLIANCE veto',
      ],
      toolAllowlist: ['read:opportunity', 'read:evidence', 'read:policy-pack'],
      prohibitedActions: ['write:opportunity', 'external:publish'],
    },
    {
      role: 'OPERATIONS_AND_QUALITY_OFFICER',
      name: 'Operations and Quality Officer',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.OPERATIONS_AND_QUALITY_OFFICER,
      responsibilities: [
        'Run QA/completeness checks once product/listing assets exist; holds a critical QUALITY veto',
      ],
      toolAllowlist: ['read:opportunity', 'read:product'],
      prohibitedActions: ['write:opportunity', 'external:publish'],
    },
    {
      role: 'RED_TEAM_AND_SECURITY_OFFICER',
      name: 'Red Team and Security Officer',
      isVoting: true,
      weight: DEFAULT_AGENT_WEIGHTS.RED_TEAM_AND_SECURITY_OFFICER,
      responsibilities: [
        'Evaluate security/integration/credential risk; holds a critical SECURITY veto',
      ],
      toolAllowlist: ['read:opportunity', 'read:integrations'],
      prohibitedActions: ['write:opportunity', 'external:publish', 'integration:manage'],
    },
    {
      role: 'DECISION_SYNTHESISER',
      name: 'Decision Synthesiser',
      isVoting: false,
      weight: null,
      responsibilities: [
        'Summarise agreement/disagreement/vetoes/confidence across the board review into readable text',
      ],
      toolAllowlist: ['read:board-review'],
      prohibitedActions: [
        'vote',
        'approve',
        'override-veto',
        'execute',
        'write:opportunity',
        'external:publish',
      ],
    },
  ];

  const boardAgentRoleSet: Set<string> = new Set(BOARD_AGENT_ROLES);
  for (const def of AGENT_DEFINITIONS) {
    // Sanity-check the seed data matches the unit-tested role list in
    // @ventureos/contracts -- fail-fast guard against a typo'd role name,
    // not runtime business logic.
    if (def.isVoting && !boardAgentRoleSet.has(def.role)) {
      throw new Error(`Unknown voting agent role in seed: ${def.role}`);
    }
    const agentDefinition = await prisma.agentDefinition.upsert({
      where: { role: def.role },
      update: {
        name: def.name,
        isVoting: def.isVoting,
        weight: def.weight,
        responsibilities: def.responsibilities,
        toolAllowlist: def.toolAllowlist,
        prohibitedActions: def.prohibitedActions,
      },
      create: {
        role: def.role,
        name: def.name,
        isVoting: def.isVoting,
        weight: def.weight,
        responsibilities: def.responsibilities,
        toolAllowlist: def.toolAllowlist,
        prohibitedActions: def.prohibitedActions,
      },
    });
    await prisma.agentPromptVersion.upsert({
      where: {
        agentDefinitionId_version: { agentDefinitionId: agentDefinition.id, version: 'v1' },
      },
      update: {},
      create: {
        agentDefinitionId: agentDefinition.id,
        version: 'v1',
        promptText: `[Phase 3 mock provider] ${def.name}: ${def.responsibilities.join('; ')}.`,
        isActive: true,
      },
    });
  }

  // --- Phase 4: Etsy Digital Products Development Pack (mock, draft-only --
  // master spec section 21). This literal mirrors
  // packages/product-studio/src/marketplace-policy-pack.ts's
  // ETSY_DEV_PACK_CONTENT exactly, duplicated here rather than imported
  // because @ventureos/database cannot depend on @ventureos/product-studio
  // (product-studio already depends on @ventureos/database -- that would be
  // a circular workspace dependency). Keep the two literals in sync by
  // hand if the pack content ever changes. ---
  const etsyPack = await prisma.marketplacePolicyPack.upsert({
    where: { marketplace: 'etsy' },
    update: { name: 'Etsy Digital Products' },
    create: { marketplace: 'etsy', name: 'Etsy Digital Products' },
  });

  const policyPackNow = new Date();
  const policyPackReviewDueAt = new Date(policyPackNow.getTime() + 180 * 24 * 60 * 60 * 1000);
  const etsyPackVersionData = {
    supportedProductTypes: ['DIGITAL_TEMPLATE_BUNDLE', 'PRINTABLE', 'PLANNER', 'SPREADSHEET_TOOL'],
    listingFieldRequirements: {
      title: { maxLength: 140, required: true },
      description: { maxLength: 5000, required: true },
      tags: { max: 13, maxLengthEach: 20 },
      category: { required: true },
    },
    imageRequirements: { minCount: 1, maxCount: 10, minWidthPx: 2000, formats: ['PNG', 'JPEG'] },
    fileRequirements: {
      maxFileCount: 5,
      maxTotalSizeMb: 20,
      allowedTypes: ['PDF', 'ZIP', 'CSV', 'PNG', 'JPEG'],
    },
    restrictedCategories: ['adult content', 'weapons', 'counterfeit goods'],
    ipChecks: ['no third-party trademarks', 'no copyrighted stock imagery without a licence'],
    pricingRules: { minPriceEur: 0.2, maxPriceEur: 5000, currency: 'EUR' },
    apiCapabilities: [
      'create_draft_listing',
      'update_draft_listing',
      'upload_listing_image',
      'upload_digital_file',
    ],
    draftModeOnly: true,
    publicationRequirements: ['founder approval', 'QA passed', 'licence complete', 'SEO evaluated'],
    rateLimits: { requestsPerSecond: 5, requestsPerDay: 5000 },
    approvalRequirements: ['founder ApprovalRequest decided APPROVE or APPROVE_WITH_CONDITIONS'],
    lastVerifiedAt: policyPackNow,
    reviewDueAt: policyPackReviewDueAt,
    isActive: true,
  };
  await prisma.marketplacePolicyPackVersion.upsert({
    where: {
      marketplacePolicyPackId_version: { marketplacePolicyPackId: etsyPack.id, version: 'v1' },
    },
    update: etsyPackVersionData,
    create: { marketplacePolicyPackId: etsyPack.id, version: 'v1', ...etsyPackVersionData },
  });

  // --- Phase 2 pilot opportunity: "Social Media Content Planning Kit" ---
  // Master spec section 25. Every number below is clearly seed/mock data,
  // not a real market claim - see the EvidenceArtifact/EvidenceClaim records
  // for the (also mock) provenance behind each one. Deliberately designed so
  // the Opportunity Score lands >=70 while the Profit Confidence Score lands
  // <70, demonstrating the "speculative" flag required by master spec
  // section 18.
  const etsyBrowseSource = await prisma.dataSource.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000e1' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-0000000000e1',
      name: 'Etsy Marketplace (public category browse)',
      sourceType: 'PUBLIC_EXPORT',
      url: 'https://www.etsy.com',
      accessMethod: 'MANUAL_IMPORT',
    },
  });
  const etsyHandbookSource = await prisma.dataSource.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000e2' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-0000000000e2',
      name: 'Etsy Seller Handbook (published fee schedule)',
      sourceType: 'OFFICIAL_API',
      url: 'https://www.etsy.com/seller-handbook',
      accessMethod: 'MANUAL_IMPORT',
    },
  });

  const opportunity = await prisma.opportunity.upsert({
    where: {
      workspaceId_title: { workspaceId: workspace.id, title: 'Social Media Content Planning Kit' },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      title: 'Social Media Content Planning Kit',
      description:
        'A digital planning bundle (editable spreadsheet + printable templates) that helps solo business owners and small-business social media managers plan a full month of content in advance, across multiple platforms, without a dedicated marketing team.',
      status: 'NEW',
      suggestedProductType: 'Digital Template Bundle',
      suggestedMarketplace: 'etsy',
      estimatedCostEur: 45,
      estimatedRevenueEur: 850,
      estimatedProfitEur: 805,
      timeToLaunchDays: 14,
      risks: [
        'Marketplace saturation for planner/template products',
        'Etsy policy changes affecting digital template listings',
        'Low differentiation versus existing competing templates',
      ],
    },
  });

  await prisma.targetCustomer.deleteMany({ where: { opportunityId: opportunity.id } });
  await prisma.targetCustomer.create({
    data: {
      opportunityId: opportunity.id,
      persona:
        'Solo social media managers and small-business owners juggling content planning without a dedicated marketing team',
      painPoints: [
        'No time to plan content in advance',
        'Inconsistent posting schedule',
        'Difficulty tracking content themes across platforms',
      ],
      buyingTriggers: [
        'Starting a new quarter or month',
        'Hiring a VA and needing a repeatable system',
        'Burnout from ad-hoc, reactive posting',
      ],
    },
  });

  await prisma.channelRecommendation.deleteMany({ where: { opportunityId: opportunity.id } });
  await prisma.channelRecommendation.createMany({
    data: [
      {
        opportunityId: opportunity.id,
        channel: 'Etsy SEO (organic search)',
        rationale:
          'The digital planner/template niche has strong existing organic search demand on Etsy.',
        priority: 1,
      },
      {
        opportunityId: opportunity.id,
        channel: 'Pinterest organic pins',
        rationale: 'High-intent, visual discovery matches this product type well.',
        priority: 2,
      },
      {
        opportunityId: opportunity.id,
        channel: 'Instagram Reels (educational content)',
        rationale:
          '"How I plan my content" style educational content can drive traffic to the Etsy listing.',
        priority: 3,
      },
    ],
  });

  // --- Evidence: one artifact + claim per classification type, so every
  // claimType in the enum has a real example in seed data. ---
  await prisma.evidenceClaim.deleteMany({ where: { opportunityId: opportunity.id } });
  await prisma.evidenceArtifact.deleteMany({ where: { workspaceId: workspace.id } });

  const evidenceInputs: Array<{
    dataSourceId: string | null;
    sourceName: string;
    sourceIdentifier?: string;
    region?: string;
    collectionMethod: string;
    collectionAgent?: string;
    originalExcerpt: string | null;
    reliabilityScore: number;
    freshnessScore: number;
    relevanceScore: number;
    termsOfUseNote?: string;
    claimType: string;
    statement: string;
    value?: unknown;
  }> = [
    {
      dataSourceId: etsyHandbookSource.id,
      sourceName: 'Etsy Seller Handbook - Fees',
      sourceIdentifier: 'etsy-seller-handbook-fees',
      region: 'Global',
      collectionMethod: 'MANUAL_IMPORT',
      collectionAgent: 'Founder (manual research)',
      originalExcerpt:
        "Etsy charges a 6.5% transaction fee and a $0.20 listing fee per digital listing, as publicly published in Etsy's Seller Handbook.",
      reliabilityScore: 100,
      freshnessScore: 85,
      relevanceScore: 75,
      termsOfUseNote: 'Publicly published fee schedule; single manual read, no scraping.',
      claimType: 'VERIFIED_FACT',
      statement:
        "Etsy's standard fee structure includes a 6.5% transaction fee and a $0.20 per-listing fee for digital products.",
      value: { transactionFeePercent: 6.5, listingFeeUsd: 0.2 },
    },
    {
      dataSourceId: etsyBrowseSource.id,
      sourceName: 'Etsy category browse - Digital Planners > Social Media Templates',
      sourceIdentifier: 'etsy-category-browse-smm-templates',
      region: 'Global',
      collectionMethod: 'MANUAL_IMPORT',
      collectionAgent: 'Founder (manual research)',
      originalExcerpt:
        'Top-selling social media planner templates in this category display sales badges in the range of roughly 500-2000 sales, priced between EUR 8 and EUR 25.',
      reliabilityScore: 65,
      freshnessScore: 90,
      relevanceScore: 85,
      termsOfUseNote:
        'Publicly browsable category page; single manual visit, no scraping or bulk collection.',
      claimType: 'EXTERNAL_ESTIMATE',
      statement:
        'Comparable social media planner templates on Etsy appear to sell in the range of 500-2000 units at EUR 8-25 each.',
      value: { minPriceEur: 8, maxPriceEur: 25, minSales: 500, maxSales: 2000 },
    },
    {
      dataSourceId: null,
      sourceName: 'Founder market knowledge (informal conversations)',
      collectionMethod: 'FOUNDER_PROVIDED',
      collectionAgent: 'Founder',
      originalExcerpt:
        'Several solo-business-owner contacts have mentioned struggling to keep a consistent content calendar and would consider paying for a ready-made system.',
      reliabilityScore: 55,
      freshnessScore: 70,
      relevanceScore: 80,
      claimType: 'FOUNDER_PROVIDED_FACT',
      statement:
        'The founder has informally observed demand for content-planning systems among solo business owner contacts.',
    },
    {
      dataSourceId: null,
      sourceName: 'VentureOS finance-engine cost estimate',
      collectionMethod: 'SYSTEM_CALCULATED',
      collectionAgent: 'system',
      originalExcerpt:
        'Cost estimate computed from mock production-time-and-materials assumptions for a digital template bundle.',
      reliabilityScore: 95,
      freshnessScore: 100,
      relevanceScore: 90,
      claimType: 'SYSTEM_CALCULATED_VALUE',
      statement:
        'Estimated production cost of EUR 45, computed from mock time-and-materials assumptions.',
      value: { estimatedCostEur: 45 },
    },
    {
      dataSourceId: null,
      sourceName: 'Mock board-agent research pass (Phase 3 preview, not yet real)',
      collectionMethod: 'MANUAL_IMPORT',
      collectionAgent: 'mock-market-intelligence-agent',
      originalExcerpt:
        'Assumed that roughly 15% of buyers will leave a public review, aiding future organic ranking. This is an unverified assumption, not a measured outcome.',
      reliabilityScore: 40,
      freshnessScore: 60,
      relevanceScore: 55,
      claimType: 'AGENT_ASSUMPTION',
      statement:
        'Assumes approximately 15% of buyers will leave a public review, aiding future organic ranking (unverified).',
      value: { assumedReviewRate: 0.15 },
    },
    {
      dataSourceId: null,
      sourceName: 'No repeat-purchase data available',
      collectionMethod: 'MANUAL_IMPORT',
      originalExcerpt: null,
      reliabilityScore: 0,
      freshnessScore: 0,
      relevanceScore: 50,
      claimType: 'UNKNOWN',
      statement:
        'Repeat-purchase rate and customer lifetime value for this product category are not yet known - this workspace has no sales history.',
    },
  ];

  for (const input of evidenceInputs) {
    const contentHash = hashContent(input.originalExcerpt ?? input.sourceName);
    const artifact = await prisma.evidenceArtifact.create({
      data: {
        workspaceId: workspace.id,
        dataSourceId: input.dataSourceId,
        sourceName: input.sourceName,
        sourceIdentifier: input.sourceIdentifier,
        retrievedAt: new Date(),
        region: input.region,
        collectionMethod: input.collectionMethod,
        collectionAgent: input.collectionAgent,
        originalExcerpt: input.originalExcerpt ?? undefined,
        reliabilityScore: input.reliabilityScore,
        freshnessScore: input.freshnessScore,
        relevanceScore: input.relevanceScore,
        termsOfUseNote: input.termsOfUseNote,
        contentHash,
      },
    });
    await prisma.evidenceClaim.create({
      data: {
        workspaceId: workspace.id,
        evidenceArtifactId: artifact.id,
        opportunityId: opportunity.id,
        claimType: input.claimType,
        statement: input.statement,
        value: input.value as never,
      },
    });
  }

  // --- Scores: computed for real via @ventureos/scoring-engine, never
  // hand-typed. Factor inputs below are the seed's own judgment calls,
  // clearly separate from the evidence records above they're informed by. ---
  const opportunityFactors = {
    demand: 70,
    trendStrength: 65,
    competitionAttractiveness: 55,
    expectedMargin: 80,
    productDifferentiation: 50,
    productionFeasibility: 90,
    organicMarketingPotential: 70,
    marketplacePolicyRisk: 85,
    intellectualPropertyRisk: 90,
    evidenceConfidence: 60,
    timeToLaunch: 85,
  };
  const opportunityScoreResult = calculateOpportunityScore(opportunityFactors);

  const profitConfidenceFactors = {
    evidenceQuality: 55,
    sampleSize: 40,
    costCertainty: 75,
    marketplaceFeeCertainty: 95,
    comparableProductQuality: 60,
    forecastRangeWidth: 50,
    historicalModelAccuracy: 50,
    channelMaturity: 65,
    assumptionSensitivity: 45,
    dataFreshness: 80,
  };
  const profitConfidenceResult = calculateProfitConfidenceScore(
    profitConfidenceFactors,
    opportunityScoreResult.score,
  );

  await prisma.opportunityScore.deleteMany({ where: { opportunityId: opportunity.id } });
  await prisma.opportunityScore.create({
    data: {
      opportunityId: opportunity.id,
      scoreType: 'OPPORTUNITY',
      formulaVersion: opportunityScoreResult.formulaVersion,
      score: opportunityScoreResult.score,
      factors: opportunityFactors,
      factorContributions: opportunityScoreResult.factorContributions,
      calculatedAt: new Date(opportunityScoreResult.calculatedAt),
    },
  });
  await prisma.opportunityScore.create({
    data: {
      opportunityId: opportunity.id,
      scoreType: 'PROFIT_CONFIDENCE',
      formulaVersion: profitConfidenceResult.formulaVersion,
      score: profitConfidenceResult.score,
      factors: profitConfidenceFactors,
      isSpeculative: profitConfidenceResult.isSpeculative,
      calculatedAt: new Date(profitConfidenceResult.calculatedAt),
    },
  });

  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: {
      latestOpportunityScore: opportunityScoreResult.score,
      latestProfitConfidence: profitConfidenceResult.score,
      isSpeculative: profitConfidenceResult.isSpeculative,
    },
  });

  // --- Phase 5: DataAcquisitionContract rows (master spec section 16). Two
  // real seeded contracts covering opposite ends of the preferred source
  // order: a permitted-browser-research connector (lowest trust, tightest
  // rate limits, explicit prohibited operations) and a founder-provided
  // connector (higher trust, no rate limit, no live network access either
  // way -- research connectors are mock-by-default in Phase 5, same as
  // AI_PROVIDER=mock / MARKETPLACE_ETSY_MODE=mock in earlier phases). ---
  const etsyBrowseContract = await prisma.dataAcquisitionContract.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000c1' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-0000000000c1',
      workspaceId: workspace.id,
      name: 'Etsy public listings (permitted browse)',
      purpose:
        'Gather publicly visible price/review/rating signals for comparable digital-product listings to inform opportunity evidence.',
      sourceType: 'PERMITTED_BROWSER_RESEARCH',
      accessMethod: 'MANUAL_IMPORT',
      authenticationMethod: 'NONE',
      allowedOperations: [
        'READ_PUBLIC_LISTING_TITLE',
        'READ_PUBLIC_LISTING_PRICE',
        'READ_PUBLIC_REVIEW_COUNT',
        'READ_PUBLIC_RATING',
      ],
      prohibitedOperations: [
        'BYPASS_AUTH',
        'BYPASS_CAPTCHA',
        'COLLECT_PERSONAL_DATA',
        'MASQUERADE_AS_USER',
        'SCRAPE_BEYOND_PUBLIC_PAGES',
      ],
      rateLimitPerMinute: 5,
      rateLimitPerDay: 100,
      expectedSchema: {
        items: [{ label: 'string', value: 'string' }],
      },
      freshnessRequirementHours: 720,
      retryPolicy: 'EXPONENTIAL_BACKOFF_3_ATTEMPTS',
      failureHandling: 'FAIL_CLOSED',
      retentionDays: 365,
      personalDataClassification: 'NONE',
      termsOfUseNote:
        "Publicly browsable listing pages only; single manual/permitted visits, never bulk scraping, never bypassing Etsy's Terms of Service or rate limits.",
      geographicLimitations: 'Global (Etsy public storefront, no geo-restriction known)',
      monitoringNote:
        'Health surfaced in Integration Health as `research:etsy-public-listings-permitted-browse`.',
      disabled: false,
      costPerRunEurEstimate: 0,
    },
  });

  const founderNotesContract = await prisma.dataAcquisitionContract.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000c2' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-0000000000c2',
      workspaceId: workspace.id,
      name: 'Founder-provided market notes',
      purpose:
        'Capture informal founder observations/conversations as classified FOUNDER_PROVIDED_FACT evidence, never silently upgraded to VERIFIED_FACT.',
      sourceType: 'FOUNDER_PROVIDED',
      accessMethod: 'FOUNDER_PROVIDED',
      authenticationMethod: 'NONE',
      allowedOperations: ['READ_FOUNDER_NOTE'],
      prohibitedOperations: ['COLLECT_PERSONAL_DATA', 'BYPASS_AUTH'],
      rateLimitPerMinute: null,
      rateLimitPerDay: null,
      expectedSchema: {
        items: [{ label: 'string', value: 'string' }],
      },
      freshnessRequirementHours: 2160, // 90 days -- informal notes stay relevant longer
      retryPolicy: 'EXPONENTIAL_BACKOFF_3_ATTEMPTS',
      failureHandling: 'FAIL_CLOSED',
      retentionDays: 730,
      personalDataClassification: 'NONE',
      termsOfUseNote: 'Founder-authored notes; no external terms of use apply.',
      geographicLimitations: null,
      monitoringNote:
        'Health surfaced in Integration Health as `research:founder-provided-market-notes`.',
      disabled: false,
      costPerRunEurEstimate: 0,
    },
  });

  console.log(
    `[seed] data acquisition contracts: "${etsyBrowseContract.name}", "${founderNotesContract.name}"`,
  );

  // --- Phase 8: resellable plan tiers + the founder workspace's own
  // subscription. The founder workspace itself is put on the AGENCY plan
  // (not TRIAL) since it is the reference install this whole project is
  // built from, not a new trialing customer -- a genuinely new customer's
  // workspace (via the Phase 8 registration flow) starts on TRIAL instead,
  // see apps/api/src/modules/auth/auth.service.ts's `register` handler. ---
  const seededPlans: Record<string, { id: string }> = {};
  for (const plan of DEFAULT_PLANS) {
    const row = await prisma.plan.upsert({
      where: { key: plan.key },
      update: {
        name: plan.name,
        description: plan.description,
        priceMonthlyEur: plan.priceMonthlyEur,
        maxVentures: plan.maxVentures,
        maxWorkspaceMembers: plan.maxWorkspaceMembers,
        maxMarketplaceAccounts: plan.maxMarketplaceAccounts,
        features: plan.features,
      },
      create: {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        priceMonthlyEur: plan.priceMonthlyEur,
        maxVentures: plan.maxVentures,
        maxWorkspaceMembers: plan.maxWorkspaceMembers,
        maxMarketplaceAccounts: plan.maxMarketplaceAccounts,
        features: plan.features,
      },
    });
    seededPlans[plan.key] = { id: row.id };
  }

  const agencyPlan = seededPlans['AGENCY'];
  if (!agencyPlan) {
    throw new Error('AGENCY plan was not seeded -- DEFAULT_PLANS is missing an AGENCY entry');
  }
  const now8 = new Date();
  const periodEnd8 = new Date(now8);
  periodEnd8.setUTCMonth(periodEnd8.getUTCMonth() + 1);
  const subscription = await prisma.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      planId: agencyPlan.id,
      status: 'ACTIVE',
      billingMode: 'MOCK',
      currentPeriodStart: now8,
      currentPeriodEnd: periodEnd8,
    },
  });

  await prisma.workspaceBranding.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      brandName: 'VentureOS',
      primaryColorHex: '#4F46E5',
    },
  });

  console.log(
    `[seed] plans: ${DEFAULT_PLANS.map((p) => p.key).join(', ')}; founder workspace subscription: AGENCY (${subscription.status})`,
  );

  console.log('[seed] done.');
  console.log(
    `[seed] founder login: ${founderEmail} / (password from DEV_FOUNDER_PASSWORD env var)`,
  );
  console.log(`[seed] workspace: ${workspace.name} (${workspace.slug})`);
  console.log(
    `[seed] opportunity: "${opportunity.title}" - Opportunity Score ${opportunityScoreResult.score}, Profit Confidence ${profitConfidenceResult.score}, speculative=${profitConfidenceResult.isSpeculative}`,
  );
  console.log(`[seed] marketplace policy pack: ${etsyPack.marketplace} v1 (draft-only)`);
}

main()
  .catch((err) => {
    console.error('[seed] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
