import { enforceWorkspaceCapability, prisma, Prisma } from '@ventureos/database';

/** Fresh fail-closed gate for direct finance-engine mutations. */
export async function enforceFinanceMutation(
  workspaceId: string,
  correlationReference: string,
  client?: Prisma.TransactionClient,
): Promise<void> {
  if (client) {
    await client.$queryRaw(
      Prisma.sql`SELECT "id" FROM "subscriptions" WHERE "workspaceId" = ${workspaceId}::uuid FOR UPDATE`,
    );
  }
  await enforceWorkspaceCapability(
    {
      workspaceId,
      capability: 'FINANCE_ACCESS',
      stage: 'DISPATCH',
      providerMode: 'internal',
      recordAllow: true,
      correlationReference,
    },
    client,
    prisma,
  );
}

/** Fresh fail-closed gate for direct finance-engine reads. */
export async function enforceFinanceRead(
  workspaceId: string,
  correlationReference: string,
): Promise<void> {
  await enforceWorkspaceCapability(
    {
      workspaceId,
      capability: 'FINANCE_ACCESS',
      stage: 'DISPATCH',
      providerMode: 'internal',
      recordAllow: true,
      correlationReference,
    },
    undefined,
    prisma,
  );
}
