import { createHash } from 'node:crypto';

export const CEO_COMMANDS = [
  'status',
  'report',
  'budget',
  'agents',
  'pause',
  'resume',
  'stop',
  'verify health',
] as const;
export type CeoCommand = (typeof CEO_COMMANDS)[number] | 'instruction';
export interface CeoBinding {
  workspaceId: string;
  founderId: string;
  slackTeamId: string;
  slackUserId: string;
  slackAppId: string;
}
export interface AcceptedCeoMessage {
  eventId: string;
  channel: string;
  command: CeoCommand;
  instruction: string;
  digest: string;
}

/** Only direct, original founder messages from the bound app/workspace are instructions. */
export function acceptCeoMessage(body: unknown, binding: CeoBinding): AcceptedCeoMessage | null {
  if (!body || typeof body !== 'object') return null;
  const payload = body as Record<string, unknown>;
  if (
    payload.team_id !== binding.slackTeamId ||
    payload.api_app_id !== binding.slackAppId ||
    typeof payload.event_id !== 'string' ||
    !/^Ev[A-Za-z0-9]{1,100}$/.test(payload.event_id)
  )
    return null;
  const event = payload.event as Record<string, unknown> | undefined;
  if (
    !event ||
    event.type !== 'message' ||
    event.channel_type !== 'im' ||
    event.user !== binding.slackUserId ||
    event.subtype ||
    event.bot_id ||
    event.edited ||
    typeof event.channel !== 'string' ||
    !/^D[A-Z0-9]{1,50}$/.test(event.channel) ||
    typeof event.text !== 'string' ||
    event.text.length > 2_000 ||
    !event.text.trim()
  )
    return null;
  const instruction = event.text.trim();
  const normalized = instruction.toLowerCase();
  const command = CEO_COMMANDS.includes(normalized as (typeof CEO_COMMANDS)[number])
    ? (normalized as CeoCommand)
    : 'instruction';
  return {
    eventId: payload.event_id,
    channel: event.channel,
    command,
    instruction,
    digest: createHash('sha256')
      .update(JSON.stringify([payload.team_id, event.user, event.channel, instruction]))
      .digest('hex'),
  };
}

export function safeSlackReply(text: string): string {
  return text
    .slice(0, 3_000)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
