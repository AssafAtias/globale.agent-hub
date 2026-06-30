export interface MrContext {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  mrUrl: string;
  diff: string;
}

export interface MrPipeline { status: string; failedJobs: string[]; }
export interface MrDiscussionNote { author: string; body: string; }

// GitLab returns pipelines newest-first, so element 0 is the latest.
export function parsePipeline(pipelinesJson: unknown): { id: number; status: string } | null {
  if (!Array.isArray(pipelinesJson) || pipelinesJson.length === 0) return null;
  const p = pipelinesJson[0] as Record<string, unknown>;
  const id = p?.['id'];
  const status = p?.['status'];
  if (typeof id !== 'number' || typeof status !== 'string') return null;
  return { id, status };
}

export function parseFailedJobs(jobsJson: unknown): string[] {
  if (!Array.isArray(jobsJson)) return [];
  return jobsJson
    .filter((j) => (j as Record<string, unknown>)?.['status'] === 'failed')
    .map((j) => (j as Record<string, unknown>)?.['name'])
    .filter((n): n is string => typeof n === 'string');
}

export function parseDiscussions(discussionsJson: unknown): MrDiscussionNote[] {
  if (!Array.isArray(discussionsJson)) return [];
  const out: MrDiscussionNote[] = [];
  for (const d of discussionsJson) {
    const notes = (d as Record<string, unknown>)?.['notes'];
    if (!Array.isArray(notes)) continue;
    for (const n of notes) {
      const note = n as Record<string, unknown>;
      if (note?.['system']) continue;
      const body = note?.['body'];
      if (typeof body !== 'string') continue;
      const author = note?.['author'] as Record<string, unknown> | undefined;
      out.push({
        author: (author?.['name'] as string) ?? (author?.['username'] as string) ?? 'unknown',
        body: body.slice(0, 1000),
      });
    }
  }
  return out.slice(0, 30);
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

  async getMrPipeline(projectPath: string, mrIid: number): Promise<MrPipeline | null> {
    const encoded = encodeURIComponent(projectPath);
    const headers = { 'PRIVATE-TOKEN': this.token };
    const res = await fetch(`${this.baseUrl}/api/v4/projects/${encoded}/merge_requests/${mrIid}/pipelines`, { headers });
    if (!res.ok) throw new Error(`GitLab pipelines fetch failed: ${res.status}`);
    const p = parsePipeline(await res.json());
    if (!p) return null;
    if (p.status === 'success') return { status: 'success', failedJobs: [] };
    const jobsRes = await fetch(`${this.baseUrl}/api/v4/projects/${encoded}/pipelines/${p.id}/jobs?scope[]=failed`, { headers });
    const failedJobs = jobsRes.ok ? parseFailedJobs(await jobsRes.json()) : [];
    return { status: p.status, failedJobs };
  }

  async getMrDiscussions(projectPath: string, mrIid: number): Promise<MrDiscussionNote[]> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${encoded}/merge_requests/${mrIid}/discussions`,
      { headers: { 'PRIVATE-TOKEN': this.token } },
    );
    if (!res.ok) throw new Error(`GitLab discussions fetch failed: ${res.status}`);
    return parseDiscussions(await res.json());
  }
}
