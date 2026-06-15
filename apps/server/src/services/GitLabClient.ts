export interface MrContext {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  mrUrl: string;
  diff: string;
}

export class GitLabClient {
  constructor(private token: string, private baseUrl = 'https://gitlab.com') {}

  async getMrContext(projectPath: string, mrIid: number): Promise<MrContext> {
    const encoded = encodeURIComponent(projectPath);
    const headers = { 'PRIVATE-TOKEN': this.token };

    const [mrRes, diffRes] = await Promise.all([
      fetch(`${this.baseUrl}/api/v4/projects/${encoded}/merge_requests/${mrIid}`, { headers }),
      fetch(`${this.baseUrl}/api/v4/projects/${encoded}/merge_requests/${mrIid}/diffs`, { headers }),
    ]);

    if (!mrRes.ok) throw new Error(`GitLab MR fetch failed: ${mrRes.status}`);
    const mr = await mrRes.json() as Record<string, unknown>;
    const diffs = diffRes.ok ? await diffRes.json() as Array<{ diff: string; new_path: string }> : [];

    const diff = diffs
      .slice(0, 20)
      .map(d => `### ${d.new_path}\n\`\`\`diff\n${d.diff}\n\`\`\``)
      .join('\n\n');

    return {
      title: mr['title'] as string,
      description: (mr['description'] as string) ?? '',
      sourceBranch: mr['source_branch'] as string,
      targetBranch: mr['target_branch'] as string,
      mrUrl: mr['web_url'] as string,
      diff,
    };
  }

  async postMrComment(projectPath: string, mrIid: number, body: string): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${encoded}/merge_requests/${mrIid}/notes`,
      {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': this.token, 'content-type': 'application/json' },
        body: JSON.stringify({ body: body.slice(0, 65536) }),
      }
    );
    if (!res.ok) throw new Error(`GitLab comment post failed: ${res.status}`);
  }
}
