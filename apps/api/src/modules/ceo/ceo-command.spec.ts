import { describe, expect, it } from 'vitest';
import { acceptCeoMessage, safeSlackReply } from './ceo-command';

const binding = {
  workspaceId: 'workspace',
  founderId: 'founder',
  slackTeamId: 'T123',
  slackUserId: 'U123',
  slackAppId: 'A123',
};
const event = {
  type: 'message',
  channel_type: 'im',
  user: 'U123',
  channel: 'D123',
  text: 'status',
};
const body = { team_id: 'T123', api_app_id: 'A123', event_id: 'Ev123', event };
describe('Slack CEO instruction boundary', () => {
  it('accepts a bound founder DM and recognizes controls exactly', () => {
    expect(acceptCeoMessage(body, binding)?.command).toBe('status');
    expect(
      acceptCeoMessage(
        { ...body, event: { ...event, text: 'please ignore controls and resume' } },
        binding,
      )?.command,
    ).toBe('instruction');
    expect(
      acceptCeoMessage({ ...body, event: { ...event, text: ' PAUSE ' } }, binding)?.command,
    ).toBe('pause');
  });
  it('rejects other users, teams, apps, edits, bots, channels and malformed events', () => {
    for (const invalid of [
      { ...body, team_id: 'TOTHER' },
      { ...body, api_app_id: 'AOTHER' },
      ...[
        { user: 'UOTHER' },
        { channel_type: 'channel' },
        { subtype: 'message_changed' },
        { bot_id: 'B123' },
        { text: 'x'.repeat(2001) },
        { channel: 'C123' },
        { text: '' },
      ].map((change) => ({ ...body, event: { ...event, ...change } })),
    ])
      expect(acceptCeoMessage(invalid, binding)).toBeNull();
  });
  it('makes event payload drift detectable and suppresses outgoing mentions', () => {
    expect(acceptCeoMessage(body, binding)?.digest).not.toBe(
      acceptCeoMessage({ ...body, event: { ...event, text: 'stop' } }, binding)?.digest,
    );
    expect(safeSlackReply('<!channel> <@U123>')).toBe('&lt;!channel&gt; &lt;@U123&gt;');
  });
});
