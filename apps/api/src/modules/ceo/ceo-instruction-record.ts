import { acceptCeoMessage, type CeoBinding } from './ceo-command';

export interface CeoInstructionRecord {
  workspace_id: string;
  event_id: string;
  channel_id: string;
  command: string;
  instruction: string;
  payload_digest: string;
  founder_id: string | null;
  slack_team_id: string | null;
  slack_user_id: string | null;
  slack_app_id: string | null;
}

/** Content integrity only. The caller must separately check current owner authority.
 * Legacy rows cannot be attributed to today's configuration after the fact.
 */
export function verifyCeoInstructionRecord(
  record: CeoInstructionRecord,
  binding: CeoBinding,
  eventId: string,
) {
  if (
    record.workspace_id !== binding.workspaceId ||
    record.event_id !== eventId ||
    record.founder_id !== binding.founderId ||
    record.slack_team_id !== binding.slackTeamId ||
    record.slack_user_id !== binding.slackUserId ||
    record.slack_app_id !== binding.slackAppId ||
    record.command !== 'instruction'
  )
    throw new Error('Stored owner instruction provenance does not match the current binding');

  const message = acceptCeoMessage(
    {
      team_id: record.slack_team_id,
      api_app_id: record.slack_app_id,
      event_id: record.event_id,
      event: {
        type: 'message',
        channel_type: 'im',
        user: record.slack_user_id,
        channel: record.channel_id,
        text: record.instruction,
      },
    },
    binding,
  );
  if (
    !message ||
    message.command !== 'instruction' ||
    message.instruction !== record.instruction ||
    message.digest !== record.payload_digest
  )
    throw new Error('Stored owner instruction content failed integrity verification');
  return message;
}
