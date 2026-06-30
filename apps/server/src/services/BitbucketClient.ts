import type { MrContext } from './GitLabClient.js';

/** Bearer by default; Basic base64(username:token) when a username (app-password flow) is given. */
export function bitbucketAuthHeader(token: string, username?: string): string {
  return username
    ? `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
    : `Bearer ${token}`;
}

/** Map a Bitbucket Cloud PR JSON object + raw diff text into the shared MrContext shape. */
export function prJsonToMrContext(pr: unknown, diff: string): MrContext {
  const p = (pr ?? {}) as Record<string, unknown>;
  const source = (p['source'] as Record<string, unknown>)?.['branch'] as Record<string, unknown> | undefined;
  const dest = (p['destination'] as Record<string, unknown>)?.['branch'] as Record<string, unknown> | undefined;
  const html = (p['links'] as Record<string, unknown>)?.['html'] as Record<string, unknown> | undefined;
  return {
    title: (p['title'] as string) ?? '',
    description: (p['description'] as string) ?? '',
    sourceBranch: (source?.['name'] as string) ?? '',
    targetBranch: (dest?.['name'] as string) ?? '',
    mrUrl: (html?.['href'] as string) ?? '',
    diff,
  };
}

export class BitbucketClient {
  constructor(private token: string, private username?: string, private baseUrl = 'https://api.bitbucket.org') {}

  // workspaceRepo is "{workspace}/{repo_slug}" — the slash is preserved (not encoded).
  async getPrContext(workspaceRepo: string, prId: number): Promise<MrContext> {
    const headers = { Authorization: bitbucketAuthHeader(this.token, this.username) };
    const base = `${this.baseUrl}/2.0/repositories/${workspaceRepo}/pullrequests/${prId}`;
    const [prRes, diffRes] = await Promise.all([
      fetch(base, { headers }),
      fetch(`${base}/diff`, { headers }),
    ]);
    if (!prRes.ok) throw new Error(`Bitbucket PR fetch failed: ${prRes.status}`);
    const pr = await prRes.json();
    const diff = diffRes.ok ? (await diffRes.text()).slice(0, 60000) : '';
    return prJsonToMrContext(pr, diff);
  }

  async postPrComment(workspaceRepo: string, prId: number, body: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/2.0/repositories/${workspaceRepo}/pullrequests/${prId}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: bitbucketAuthHeader(this.token, this.username),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: { raw: body.slice(0, 32000) } }),
      },
    );
    if (!res.ok) throw new Error(`Bitbucket comment post failed: ${res.status}`);
  }
}
