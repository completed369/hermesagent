import { describe, expect, it } from 'vitest';
import { acceptCeoMessage } from './ceo-command';
import { verifyCeoInstructionRecord, type CeoInstructionRecord } from './ceo-instruction-record';

const binding = {
  workspaceId: 'workspace',
  founderId: 'owner',
  slackTeamId: 'T123',
  slackUserId: 'U123',
  slackAppId: 'A123',
};
const instruction = 'Compare useful offers. Treat this as a goal, not spending authority.';
const accepted = acceptCeoMessage(
  {
    team_id: 'T123',
    api_app_id: 'A123',
    event_id: 'Ev123',
    event: {
      type: 'message',
      channel_type: 'im',
      user: 'U123',
      channel: 'D123',
      text: instruction,
    },
  },
  binding,
)!;
const record: CeoInstructionRecord = {
  workspace_id: 'workspace',
  event_id: 'Ev123',
  channel_id: 'D123',
  command: 'instruction',
  instruction,
  payload_digest: accepted.digest,
  founder_id: 'owner',
  slack_team_id: 'T123',
  slack_user_id: 'U123',
  slack_app_id: 'A123',
};

describe('stored instruction integrity', () => {
  it('recovers exactly the originally accepted content and digest after serialization', () => {
    expect(
      verifyCeoInstructionRecord(JSON.parse(JSON.stringify(record)), binding, 'Ev123'),
    ).toEqual(accepted);
  });
  it.each([
    { workspace_id: 'other-workspace' },
    { event_id: 'EvOther' },
    { founder_id: 'other-owner' },
    { slack_team_id: 'TOTHER' },
    { slack_user_id: 'UOTHER' },
    { slack_app_id: 'AOTHER' },
    { channel_id: 'DOTHER' },
    { instruction: 'Buy something' },
    { instruction: ` ${instruction}` },
    { instruction: 'x'.repeat(2001) },
    { command: 'resume' },
    { payload_digest: 'a'.repeat(64) },
    { founder_id: null, slack_team_id: null, slack_user_id: null, slack_app_id: null },
  ])('rejects changed or missing provenance: %j', (change) => {
    expect(() => verifyCeoInstructionRecord({ ...record, ...change }, binding, 'Ev123')).toThrow();
  });
  it('does not reinterpret control commands as research even with a matching digest', () => {
    const control = acceptCeoMessage(
      {
        team_id: 'T123',
        api_app_id: 'A123',
        event_id: 'Ev123',
        event: {
          type: 'message',
          channel_type: 'im',
          user: 'U123',
          channel: 'D123',
          text: 'resume',
        },
      },
      binding,
    )!;
    expect(() =>
      verifyCeoInstructionRecord(
        { ...record, instruction: 'resume', payload_digest: control.digest },
        binding,
        'Ev123',
      ),
    ).toThrow();
  });
});
