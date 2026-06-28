import { JiraClient } from '../src/services/JiraClient.js';

const ISSUE = {
  key: 'CORE-1', fields: {
    summary: 'Fix thing',
    description: { content: [{ content: [{ text: 'do it' }] }] },
    status: { name: 'Open' }, labels: [],
  },
};

describe('JiraClient.searchFirstOpenAssigned', () => {
  afterEach(() => { (global.fetch as any) = undefined; });

  it('returns the first issue mapped to JiraTicketContext', async () => {
    let captured: any = null;
    global.fetch = jest.fn(async (_url, opts: any) => {
      captured = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ issues: [ISSUE] }) } as any;
    });
    const c = new JiraClient('t', 'https://j.example.com');
    const res = await c.searchFirstOpenAssigned('CORE');
    expect(res?.key).toBe('CORE-1');
    expect(res?.summary).toBe('Fix thing');
    expect(res?.status).toBe('Open');
    expect(res?.url).toBe('https://j.example.com/browse/CORE-1');
    expect(captured.jql).toContain('project = CORE');
    expect(captured.jql).toContain('assignee = currentUser()');
    expect(captured.jql).toContain('status = "Open"');
    expect(captured.maxResults).toBe(1);
  });

  it('returns null when no issues match', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ issues: [] }) }) as any);
    const c = new JiraClient('t', 'https://j.example.com');
    expect(await c.searchFirstOpenAssigned('CORE')).toBeNull();
  });

  it('throws on non-OK response', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 }) as any);
    const c = new JiraClient('t', 'https://j.example.com');
    await expect(c.searchFirstOpenAssigned('CORE')).rejects.toThrow('403');
  });
});
