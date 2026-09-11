import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, prisma } from '@ventureos/database';
import { acceptCeoMessage, type CeoBinding } from '../src/modules/ceo/ceo-command';
import {
  verifyCeoInstructionRecord,
  type CeoInstructionRecord,
} from '../src/modules/ceo/ceo-instruction-record';

describe('CEO instruction provenance (PostgreSQL integration)', () => {
  let binding: CeoBinding;
  let otherWorkspace: string;

  beforeAll(async () => {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: 'Instruction provenance', slug: `ceo-source-${suffix}` },
    });
    binding = {
      workspaceId: workspace.id,
      founderId: randomUUID(),
      slackTeamId: 'T123',
      slackUserId: 'U123',
      slackAppId: 'A123',
    };
    otherWorkspace = (
      await prisma.workspace.create({
        data: { name: 'Other instruction workspace', slug: `ceo-other-${suffix}` },
      })
    ).id;
  });

  afterAll(async () => {
    if (binding)
      await prisma.workspace.deleteMany({
        where: { id: { in: [binding.workspaceId, otherWorkspace] } },
      });
  });

  it('preserves accepted content while allowing queue recovery and denies tenant or sender substitution', async () => {
    const message = acceptCeoMessage(
      {
        team_id: binding.slackTeamId,
        api_app_id: binding.slackAppId,
        event_id: 'EvPersisted',
        event: {
          type: 'message',
          channel_type: 'im',
          user: binding.slackUserId,
          channel: 'D123',
          text: 'Research a useful paid service',
        },
      },
      binding,
    )!;
    await prisma.$executeRaw(Prisma.sql`INSERT INTO ceo_slack_inbox
      (workspace_id,event_id,channel_id,command,instruction,payload_digest,founder_id,slack_team_id,slack_user_id,slack_app_id)
      VALUES (${binding.workspaceId}::uuid,${message.eventId},${message.channel},${message.command},${message.instruction},${message.digest},
        ${binding.founderId}::uuid,${binding.slackTeamId},${binding.slackUserId},${binding.slackAppId})`);
    const rows = await prisma.$queryRaw<
      CeoInstructionRecord[]
    >(Prisma.sql`SELECT * FROM ceo_slack_inbox
      WHERE workspace_id=${binding.workspaceId}::uuid AND event_id=${message.eventId}`);
    expect(verifyCeoInstructionRecord(rows[0]!, binding, message.eventId)).toEqual(message);
    expect(() =>
      verifyCeoInstructionRecord(
        rows[0]!,
        { ...binding, founderId: randomUUID() },
        message.eventId,
      ),
    ).toThrow();
    expect(
      await prisma.$queryRaw(Prisma.sql`SELECT * FROM ceo_slack_inbox
      WHERE workspace_id=${otherWorkspace}::uuid AND event_id=${message.eventId}`),
    ).toEqual([]);

    for (const update of [
      Prisma.sql`instruction='Replaced instruction'`,
      Prisma.sql`payload_digest=${'b'.repeat(64)}`,
      Prisma.sql`founder_id=${randomUUID()}::uuid`,
      Prisma.sql`slack_team_id='TOTHER'`,
      Prisma.sql`slack_user_id='UOTHER'`,
      Prisma.sql`slack_app_id='AOTHER'`,
      Prisma.sql`channel_id='DOTHER'`,
      Prisma.sql`command='resume'`,
      Prisma.sql`event_id='EvOther'`,
      Prisma.sql`workspace_id=${otherWorkspace}::uuid`,
    ]) {
      await expect(
        prisma.$executeRaw(Prisma.sql`UPDATE ceo_slack_inbox SET ${update}
        WHERE workspace_id=${binding.workspaceId}::uuid AND event_id=${message.eventId}`),
      ).rejects.toThrow('immutable');
    }
    expect(
      await prisma.$executeRaw(Prisma.sql`UPDATE ceo_slack_inbox SET state='REPLY_READY',attempts=1,
      lease_id=${randomUUID()}::uuid,lease_until=clock_timestamp()+interval '45 seconds',reply='Queued, not executed',result_digest=${'c'.repeat(64)}
      WHERE workspace_id=${binding.workspaceId}::uuid AND event_id=${message.eventId}`),
    ).toBe(1);
    const recovered = await prisma.$queryRaw<
      CeoInstructionRecord[]
    >(Prisma.sql`SELECT * FROM ceo_slack_inbox
      WHERE workspace_id=${binding.workspaceId}::uuid AND event_id=${message.eventId}`);
    expect(verifyCeoInstructionRecord(recovered[0]!, binding, message.eventId)).toEqual(message);
  });

  it('retains legacy rows without inventing their sender and rejects partial provenance', async () => {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO ceo_slack_inbox
      (workspace_id,event_id,channel_id,command,instruction,payload_digest)
      VALUES (${binding.workspaceId}::uuid,'EvLegacy','D123','instruction','Historical instruction',${'a'.repeat(64)})`);
    const [legacy] = await prisma.$queryRaw<
      CeoInstructionRecord[]
    >(Prisma.sql`SELECT * FROM ceo_slack_inbox
      WHERE workspace_id=${binding.workspaceId}::uuid AND event_id='EvLegacy'`);
    expect(() => verifyCeoInstructionRecord(legacy!, binding, 'EvLegacy')).toThrow('provenance');
    await expect(
      prisma.$executeRaw(Prisma.sql`UPDATE ceo_slack_inbox SET founder_id=${binding.founderId}::uuid,
      slack_team_id=${binding.slackTeamId},slack_user_id=${binding.slackUserId},slack_app_id=${binding.slackAppId}
      WHERE workspace_id=${binding.workspaceId}::uuid AND event_id='EvLegacy'`),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.$executeRaw(Prisma.sql`INSERT INTO ceo_slack_inbox
      (workspace_id,event_id,channel_id,command,instruction,payload_digest,founder_id)
      VALUES (${binding.workspaceId}::uuid,'EvPartial','D123','instruction','Incomplete sender',${'a'.repeat(64)},${binding.founderId}::uuid)`),
    ).rejects.toThrow('ceo_slack_sender_complete');
  });
});
