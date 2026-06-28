import { TeamsNotifier, formatTeamsResult, createTeamsAdapter } from '../../src/services/teams/TeamsNotifier.js';

describe('formatTeamsResult', () => {
  it('prefixes the agent name', () => {
    expect(formatTeamsResult('all good', 'PR Review')).toMatch(/PR Review/);
    expect(formatTeamsResult('all good', 'PR Review')).toMatch(/all good/);
  });
  it('truncates very long results', () => {
    const out = formatTeamsResult('x'.repeat(50_000), 'A');
    expect(out.length).toBeLessThan(20_000);
    expect(out).toMatch(/truncated/i);
  });
});

describe('TeamsNotifier.post', () => {
  it('continues the conversation and sends the text', async () => {
    const calls: any[] = [];
    const fakeAdapter = {
      continueConversationAsync: async (appId: string, ref: object, logic: Function) => {
        calls.push({ appId, ref });
        await logic({ sendActivity: async (t: string) => calls.push({ sent: t }) });
      },
    };
    const notifier = new TeamsNotifier(fakeAdapter as any, 'app-1');
    await notifier.post({ conversation: { id: 'c1' } }, 'hello');
    expect(calls[0]).toMatchObject({ appId: 'app-1', ref: { conversation: { id: 'c1' } } });
    expect(calls[1]).toEqual({ sent: 'hello' });
  });
});

describe('createTeamsAdapter', () => {
  it('throws when MICROSOFT_APP_ID is absent', () => {
    expect(() => createTeamsAdapter({} as any)).toThrow('MICROSOFT_APP_ID');
  });
});
