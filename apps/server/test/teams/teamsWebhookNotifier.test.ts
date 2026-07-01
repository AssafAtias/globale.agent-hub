import { buildAgentCard, buildVwoCard, TeamsWebhookNotifier } from '../../src/services/teams/TeamsWebhookNotifier.js';

describe('buildAgentCard', () => {
  it('returns the correct envelope shape', () => {
    const card = buildAgentCard('My Agent', 'done', 'All good.');
    expect(card).toMatchObject({ type: 'message' });
    const envelope = card as any;
    expect(Array.isArray(envelope.attachments)).toBe(true);
    expect(envelope.attachments).toHaveLength(1);
    const att = envelope.attachments[0];
    expect(att.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(att.content.type).toBe('AdaptiveCard');
    expect(att.content['$schema']).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
    expect(att.content.version).toBe('1.4');
  });

  it('title contains agentName and done markers for done status', () => {
    const card = buildAgentCard('ReviewBot', 'done', 'Looks great.') as any;
    const titleBlock = card.attachments[0].content.body[0];
    expect(titleBlock.weight).toBe('Bolder');
    expect(titleBlock.size).toBe('Medium');
    expect(titleBlock.text).toContain('ReviewBot');
    expect(titleBlock.text).toContain('✅');
    expect(titleBlock.text).toContain('completed');
  });

  it('title contains agentName and failed markers for failed status', () => {
    const card = buildAgentCard('ReviewBot', 'failed', 'Boom.') as any;
    const titleBlock = card.attachments[0].content.body[0];
    expect(titleBlock.text).toContain('ReviewBot');
    expect(titleBlock.text).toContain('❌');
    expect(titleBlock.text).toContain('failed');
  });

  it('body textblock has wrap:true and contains the body text', () => {
    const card = buildAgentCard('A', 'done', 'Result text here') as any;
    const bodyBlock = card.attachments[0].content.body[1];
    expect(bodyBlock.wrap).toBe(true);
    expect(bodyBlock.text).toContain('Result text here');
  });

  it('truncates a >18000-char body and appends truncated marker', () => {
    const longBody = 'x'.repeat(20_000);
    const card = buildAgentCard('A', 'done', longBody) as any;
    const bodyBlock = card.attachments[0].content.body[1];
    expect(bodyBlock.text.length).toBeLessThan(18_100);
    expect(bodyBlock.text).toContain('(truncated)');
  });
});

describe('TeamsWebhookNotifier.postResult', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to the correct URL with the correct Content-Type and adaptive-card body', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    global.fetch = jest.fn(async (url: any, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 202 } as Response;
    });

    const notifier = new TeamsWebhookNotifier('https://example.webhook.com/hook');
    await notifier.postResult('DeployBot', 'done', 'Deployed successfully.');

    expect(capturedUrl).toBe('https://example.webhook.com/hook');
    expect((capturedInit?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json; charset=utf-8');

    const parsed = JSON.parse(capturedInit?.body as string);
    expect(parsed.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });

  it('throws when response is not ok, including the status code', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 400 } as Response));

    const notifier = new TeamsWebhookNotifier('https://example.webhook.com/hook');
    await expect(notifier.postResult('A', 'failed', 'err')).rejects.toThrow('400');
  });
});

describe('buildVwoCard', () => {
  it('failure card uses ❌ and a DOWN title', () => {
    const card = buildVwoCard('failure', ['merchant 1: FAILED reason=campaign_missing']) as any;
    const title = card.attachments[0].content.body[0].text;
    expect(title).toContain('❌');
    expect(title).toContain('DOWN');
    expect(card.attachments[0].content.body[1].text).toContain('campaign_missing');
  });
  it('recovery card uses ✅ and a RECOVERED title', () => {
    const title = (buildVwoCard('recovery', ['ok']) as any).attachments[0].content.body[0].text;
    expect(title).toContain('✅');
    expect(title).toContain('RECOVERED');
  });
  it('heartbeat card uses ✅ and a healthy title', () => {
    const title = (buildVwoCard('heartbeat', ['ok']) as any).attachments[0].content.body[0].text;
    expect(title).toContain('✅');
    expect(title).toMatch(/healthy/i);
  });
  it('joins multiple lines into the body', () => {
    const body = (buildVwoCard('heartbeat', ['line-a', 'line-b']) as any).attachments[0].content.body[1].text;
    expect(body).toContain('line-a');
    expect(body).toContain('line-b');
  });
});

describe('TeamsWebhookNotifier.postCard', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('posts the given card to the URL with the correct Content-Type', async () => {
    let capturedUrl = ''; let capturedInit: any;
    global.fetch = jest.fn(async (url: any, init: any) => { capturedUrl = String(url); capturedInit = init; return { ok: true, status: 202 } as Response; }) as any;
    const { TeamsWebhookNotifier } = await import('../../src/services/teams/TeamsWebhookNotifier.js');
    const notifier = new TeamsWebhookNotifier('https://hook');
    await notifier.postCard(buildVwoCard('heartbeat', ['ok']));
    expect(capturedUrl).toBe('https://hook');
    expect((capturedInit.headers as Record<string, string>)['Content-Type']).toBe('application/json; charset=utf-8');
  });

  it('throws with the status code on a non-ok response', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 429 } as Response)) as any;
    const { TeamsWebhookNotifier } = await import('../../src/services/teams/TeamsWebhookNotifier.js');
    await expect(new TeamsWebhookNotifier('https://hook').postCard({})).rejects.toThrow('429');
  });
});
