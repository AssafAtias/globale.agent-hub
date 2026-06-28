export interface JiraTicketContext {
  key: string;
  summary: string;
  description: string;
  status: string;
  labels: string[];
  url: string;
}

export class JiraClient {
  constructor(private token: string, private baseUrl: string) {}

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async getTicket(issueKey: string): Promise<JiraTicketContext> {
    const res = await fetch(`${this.baseUrl}/rest/api/3/issue/${issueKey}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Jira fetch failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    return this.mapIssue(data);
  }

  async postComment(issueKey: string, body: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        body: {
          type: 'doc', version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: body.slice(0, 32000) }] }],
        },
      }),
    });
    if (!res.ok) throw new Error(`Jira comment failed: ${res.status}`);
  }

  private mapIssue(data: Record<string, unknown>): JiraTicketContext {
    const fields = data['fields'] as Record<string, unknown>;
    return {
      key: data['key'] as string,
      summary: fields['summary'] as string,
      description: this.extractDescription(fields['description']),
      status: ((fields['status'] as Record<string, unknown>)?.['name'] as string) ?? 'Unknown',
      labels: (fields['labels'] as string[]) ?? [],
      url: `${this.baseUrl}/browse/${data['key']}`,
    };
  }

  async searchFirstOpenAssigned(projectKey = 'CORE'): Promise<JiraTicketContext | null> {
    const jql = `project = ${projectKey} AND assignee = currentUser() AND status = "Open" ORDER BY created ASC`;
    const res = await fetch(`${this.baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ jql, maxResults: 1, fields: ['summary', 'description', 'status', 'labels'] }),
    });
    if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);
    const data = await res.json() as { issues?: Array<Record<string, unknown>> };
    const first = data.issues?.[0];
    return first ? this.mapIssue(first) : null;
  }

  private extractDescription(desc: unknown): string {
    if (!desc || typeof desc !== 'object') return '';
    const content = ((desc as Record<string, unknown>)['content'] as unknown[]) ?? [];
    return content.flatMap((block) => {
      const blockContent = ((block as Record<string, unknown>)['content'] as Array<Record<string, unknown>>) ?? [];
      return blockContent.map(n => (n['text'] as string) ?? '');
    }).join('\n');
  }
}
