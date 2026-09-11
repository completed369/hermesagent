import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@ventureos/database';
import {
  readBusinessBudget,
  setBusinessExecutionStateInTransaction,
} from '@ventureos/finance-engine';
import { acceptCeoMessage, safeSlackReply, type CeoBinding } from './ceo-command';
import { CeoInstructionService } from './ceo-instruction.service';

interface Inbox {
  event_id: string;
  channel_id: string;
  command: string;
  state: string;
  reply: string | null;
  lease_id: string;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** Persistent Slack transport and read-only evidence jobs. Does not claim an autonomous planner. */
@Injectable()
export class CeoSlackService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly instructions: CeoInstructionService) {}

  private binding?: CeoBinding;
  private ready = false;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopping = false;

  async onModuleInit(): Promise<void> {
    if (process.env.CEO_SLACK_ENABLED !== 'true') return;
    if (process.env.DEPLOYMENT_ENVIRONMENT !== 'production')
      throw new Error(
        'Slack CEO activation requires a reviewed production deployment; staging remains mock-only',
      );
    const required = [
      'CEO_WORKSPACE_ID',
      'CEO_FOUNDER_ID',
      'SLACK_TEAM_ID',
      'SLACK_FOUNDER_USER_ID',
      'SLACK_APP_ID',
      'SLACK_SIGNING_SECRET',
      'SLACK_BOT_TOKEN',
    ];
    if (required.some((key) => !process.env[key]))
      throw new Error('CEO secure configuration is incomplete');
    this.binding = {
      workspaceId: process.env.CEO_WORKSPACE_ID!,
      founderId: process.env.CEO_FOUNDER_ID!,
      slackTeamId: process.env.SLACK_TEAM_ID!,
      slackUserId: process.env.SLACK_FOUNDER_USER_ID!,
      slackAppId: process.env.SLACK_APP_ID!,
    };
    await this.assertFounder();
    const identity = await this.slack('auth.test', {});
    if (!identity.ok || identity.team_id !== this.binding.slackTeamId || !identity.bot_id)
      throw new Error('CEO Slack bot identity does not match configured workspace');
    this.ready = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  private async assertFounder(): Promise<void> {
    const b = this.binding!;
    const founder = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId: b.workspaceId,
        userId: b.founderId,
        role: { key: 'FOUNDER' },
        user: { isFounder: true, deletedAt: null },
      },
    });
    if (!founder) throw new Error('CEO founder binding is not authorized');
  }

  async accept(body: unknown): Promise<void> {
    if (!this.ready || this.stopping) throw new Error('CEO Slack service is unavailable');
    const b = this.binding!;
    const message = acceptCeoMessage(body, b);
    if (!message || this.stopping) return;
    await this.assertFounder();
    await prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw(Prisma.sql`INSERT INTO ceo_slack_inbox
        (workspace_id,event_id,channel_id,command,instruction,payload_digest,
          founder_id,slack_team_id,slack_user_id,slack_app_id)
        VALUES (${b.workspaceId}::uuid,${message.eventId},${message.channel},${message.command},${message.instruction},${message.digest},
          ${b.founderId}::uuid,${b.slackTeamId},${b.slackUserId},${b.slackAppId})
        ON CONFLICT (workspace_id,event_id) DO NOTHING`);
      const [row] = await tx.$queryRaw<
        Array<{
          payload_digest: string;
          founder_id: string | null;
          slack_team_id: string | null;
          slack_user_id: string | null;
          slack_app_id: string | null;
        }>
      >(Prisma.sql`SELECT payload_digest,founder_id,slack_team_id,slack_user_id,slack_app_id FROM ceo_slack_inbox
        WHERE workspace_id=${b.workspaceId}::uuid AND event_id=${message.eventId}`);
      if (
        row?.payload_digest !== message.digest ||
        row.founder_id !== b.founderId ||
        row.slack_team_id !== b.slackTeamId ||
        row.slack_user_id !== b.slackUserId ||
        row.slack_app_id !== b.slackAppId
      )
        throw new Error('Slack event identity collision');
      if (count)
        await tx.$executeRaw(Prisma.sql`INSERT INTO ceo_slack_audit (workspace_id,event_id,kind,digest)
        VALUES (${b.workspaceId}::uuid,${message.eventId},'ACCEPTED',${message.digest})`);
      if (count && ['pause', 'resume', 'stop'].includes(message.command))
        await setBusinessExecutionStateInTransaction(tx, {
          workspaceId: b.workspaceId,
          founderId: b.founderId,
          state:
            message.command === 'pause'
              ? 'PAUSED'
              : message.command === 'stop'
                ? 'STOPPED'
                : 'RUNNING',
          evidence: `slack:${message.eventId}`,
        });
    });
  }

  private async result(item: Inbox): Promise<string> {
    const b = this.binding!;
    if (['pause', 'resume', 'stop'].includes(item.command)) {
      const state =
        item.command === 'pause' ? 'PAUSED' : item.command === 'stop' ? 'STOPPED' : 'RUNNING';
      return `Applied execution control ${state} when command ${item.event_id} was accepted. Later commands can supersede it. Paid work still requires verified funding and a reserved cost. Already-issued external actions cannot be recalled. Autonomous planning is not configured.`;
    }
    if (item.command === 'budget') {
      try {
        const budget = await readBusinessBudget(b.workspaceId);
        return (
          JSON.stringify(budget, (_key, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          ) + ' (amounts in EUR cents)'
        );
      } catch {
        return 'Budget unavailable or unconfigured. Verified available funds: unknown. New paid execution is blocked.';
      }
    }
    if (item.command === 'instruction') return this.instructions.prepare(b, item.event_id);
    const [tasks, runtimes] = await Promise.all([
      prisma.acpTask.groupBy({
        by: ['status'],
        where: { workspaceId: b.workspaceId },
        _count: { _all: true },
      }),
      prisma.acpRuntimeConnection.findMany({
        where: { workspaceId: b.workspaceId },
        select: { id: true, status: true, lastHeartbeatAt: true },
        take: 20,
      }),
    ]);
    if (item.command === 'report')
      return `Revenue, payment fees, refunds, deliveries and profit: not reconciled by this service. No financial total can be asserted. Recorded task counts: ${JSON.stringify(tasks)}. Autonomous planning is not configured.`;
    if (item.command === 'agents')
      return `Runtime records (not proof of live execution): ${JSON.stringify(runtimes)}. Autonomous planning is not configured.`;
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT clock_timestamp() AS now`,
    );
    if (!clock) throw new Error('Database health check failed');
    return `Database query verified at ${clock.now.toISOString()}. Tasks: ${JSON.stringify(tasks)}. Runtime records: ${JSON.stringify(runtimes)}. Next milestone: verified CEO execution and checkout-to-delivery. Autonomous planning is not configured.`;
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopping || !this.ready || !this.binding) return;
    this.busy = true;
    const b = this.binding;
    const lease = randomUUID();
    try {
      await this.assertFounder();
      await prisma.$executeRaw(Prisma.sql`UPDATE ceo_slack_inbox SET state='FAILED',updated_at=clock_timestamp()
        WHERE workspace_id=${b.workspaceId}::uuid AND attempts>=3
          AND founder_id=${b.founderId}::uuid AND slack_team_id=${b.slackTeamId}
          AND slack_user_id=${b.slackUserId} AND slack_app_id=${b.slackAppId}
          AND state IN ('PROCESSING','REPLY_READY') AND lease_until<clock_timestamp()`);
      const [item] = await prisma.$queryRaw<Inbox[]>(Prisma.sql`UPDATE ceo_slack_inbox SET
        state=CASE WHEN reply IS NULL THEN 'PROCESSING' ELSE 'REPLY_READY' END,
        attempts=attempts+1,lease_id=${lease}::uuid,lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp()
        WHERE (workspace_id,event_id) IN (SELECT workspace_id,event_id FROM ceo_slack_inbox
          WHERE workspace_id=${b.workspaceId}::uuid AND state IN ('QUEUED','PROCESSING','REPLY_READY')
            AND founder_id=${b.founderId}::uuid AND slack_team_id=${b.slackTeamId}
            AND slack_user_id=${b.slackUserId} AND slack_app_id=${b.slackAppId}
            AND attempts<3 AND (lease_until IS NULL OR lease_until<clock_timestamp())
          ORDER BY CASE WHEN command IN ('pause','stop') THEN 0 ELSE 1 END,created_at
          FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
      if (!item) return;
      const reply = item.reply ?? safeSlackReply(await this.result(item));
      const hash = digest(reply);
      await prisma.$transaction(async (tx) => {
        const count =
          await tx.$executeRaw(Prisma.sql`UPDATE ceo_slack_inbox SET reply=${reply},result_digest=${hash},state='REPLY_READY'
          WHERE workspace_id=${b.workspaceId}::uuid AND event_id=${item.event_id} AND lease_id=${lease}::uuid`);
        if (count !== 1) throw new Error('CEO queue lease lost');
        await tx.$executeRaw(Prisma.sql`INSERT INTO ceo_slack_audit(workspace_id,event_id,kind,digest)
          VALUES(${b.workspaceId}::uuid,${item.event_id},'RESULT_VERIFIED',${hash}) ON CONFLICT DO NOTHING`);
      });
      if (this.stopping) return;
      await this.assertFounder();
      const sent = await this.slack('chat.postMessage', {
        channel: item.channel_id,
        text: reply,
        mrkdwn: false,
        parse: 'none',
        unfurl_links: false,
        unfurl_media: false,
        client_msg_id: messageUuid(b.workspaceId, item.event_id),
      });
      if (!sent.ok || typeof sent.ts !== 'string') throw new Error('Slack reply not confirmed');
      const replyTs = sent.ts;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`UPDATE ceo_slack_inbox SET state='REPLIED',reply_ts=${replyTs},updated_at=clock_timestamp()
          WHERE workspace_id=${b.workspaceId}::uuid AND event_id=${item.event_id} AND lease_id=${lease}::uuid`);
        await tx.$executeRaw(Prisma.sql`INSERT INTO ceo_slack_audit(workspace_id,event_id,kind,digest)
          VALUES(${b.workspaceId}::uuid,${item.event_id},'REPLIED',${hash}) ON CONFLICT DO NOTHING`);
      });
    } catch {
      /* Bounded retries recover from persisted state; provider errors contain no audit payload. */
    } finally {
      this.busy = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.ready = false;
  }

  private async slack(
    method: 'auth.test' | 'chat.postMessage',
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Slack API unavailable');
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true)
      throw new Error('Slack operation was not confirmed');
    return result as Record<string, unknown>;
  }
}

function messageUuid(workspace: string, event: string): string {
  const hash = digest(`${workspace}:${event}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
