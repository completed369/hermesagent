from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    p.write_text(text.replace(old, new, 1))


provenance = "packages/finance-engine/src/commercial-observation-provenance.ts"
replace_once(
    provenance,
    """export async function getCommercialObservationProvenanceMap(
  experimentResultIds: string[],
): Promise<Map<string, CommercialObservationProvenance>> {
  const uniqueIds = [...new Set(experimentResultIds)];
  if (uniqueIds.length === 0) return new Map();
  const idSql = uniqueIds.map((id) => Prisma.sql`${id}::uuid`);
  const rows = await prisma.$queryRaw<CommercialObservationProvenanceRow[]>(""",
    """export async function getCommercialObservationProvenanceMap(
  experimentResultIds: string[],
  db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma,
): Promise<Map<string, CommercialObservationProvenance>> {
  const uniqueIds = [...new Set(experimentResultIds)];
  if (uniqueIds.length === 0) return new Map();
  const idSql = uniqueIds.map((id) => Prisma.sql`${id}::uuid`);
  const rows = (await db.$queryRaw<CommercialObservationProvenanceRow[]>(""",
)
replace_once(
    provenance,
    """    WHERE \"experimentResultId\" IN (${Prisma.join(idSql)})`,
  );
  return new Map(""",
    """    WHERE \"experimentResultId\" IN (${Prisma.join(idSql)})`,
  )) ?? [];
  return new Map(""",
)

runner = "packages/finance-engine/src/experiment-runner.ts"
replace_once(
    runner,
    """async function withCommercialObservationProvenance<
  T extends { variants: Array<{ results: Array<{ id: string }> }> },
>(experiment: T) {
  const provenanceByResultId = await getCommercialObservationProvenanceMap(
    experiment.variants.flatMap((variant) => variant.results.map((result) => result.id)),
  );""",
    """async function withCommercialObservationProvenance<
  T extends { variants: Array<{ results: Array<{ id: string }> }> },
>(experiment: T, db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma) {
  const provenanceByResultId = await getCommercialObservationProvenanceMap(
    experiment.variants.flatMap((variant) => variant.results.map((result) => result.id)),
    db,
  );""",
)
replace_once(
    runner,
    """    if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
    const experimentForApprovalHash = await withCommercialObservationProvenance(experiment);
    if (experiment.status === 'DECIDED') {
      throw new ExperimentInvalidStateError('Experiment has already been decided');
    }

    if (params.decision === 'SCALE') {""",
    """    if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
    if (experiment.status === 'DECIDED') {
      throw new ExperimentInvalidStateError('Experiment has already been decided');
    }

    await enforceFinanceMutation(
      params.workspaceId,
      `finance:experiment-decision:${params.experimentId}`,
      tx,
    );

    if (params.decision === 'SCALE') {""",
)
replace_once(
    runner,
    """      const validity = isApprovalValidForExecution(
        {""",
    """      const experimentForApprovalHash = await withCommercialObservationProvenance(
        experiment,
        tx,
      );
      const validity = isApprovalValidForExecution(
        {""",
)
replace_once(
    runner,
    """
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:experiment-decision:${params.experimentId}`,
      tx,
    );
    const updated = await tx.experiment.updateMany({""",
    """
    const updated = await tx.experiment.updateMany({""",
)

test = "packages/finance-engine/src/__tests__/capability-policy.test.ts"
replace_once(
    test,
    """vi.mock('@ventureos/database', () => ({
  Prisma: { sql: vi.fn((strings: TemplateStringsArray) => strings.join('?')) },""",
    """vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql: vi.fn((strings: TemplateStringsArray) => strings.join('?')),
    join: vi.fn((parts: unknown[]) => parts.join(',')),
  },""",
)
