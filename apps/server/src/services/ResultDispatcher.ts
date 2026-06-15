import { GitLabClient } from './GitLabClient.js';
import { JiraClient } from './JiraClient.js';
import type { AgentRow } from './AgentRepository.js';
import type { RunRow } from './RunRepository.js';

export class ResultDispatcher {
  private gitlab?: GitLabClient;
  private jira?: JiraClient;

  constructor(gitlabToken?: string, jiraToken?: string, jiraBaseUrl?: string) {
    if (gitlabToken) this.gitlab = new GitLabClient(gitlabToken);
    if (jiraToken && jiraBaseUrl) this.jira = new JiraClient(jiraToken, jiraBaseUrl);
  }

  async dispatch(run: RunRow, agent: AgentRow): Promise<void> {
    if (!run.result) return;
    const outputs = (() => { try { return JSON.parse(agent.outputs || '[]') as string[]; } catch { return [] as string[]; } })();
    const payload = (() => { try { return JSON.parse(run.triggerPayload || '{}'); } catch { return {}; } })();

    for (const output of outputs) {
      if (output === 'pr_comment' && this.gitlab) {
        await this.postGitLabComment(run.result, payload).catch(e =>
          console.error('[ResultDispatcher] pr_comment failed:', e)
        );
      }
      if (output === 'jira' && this.jira) {
        await this.postJiraComment(run.result, payload).catch(e =>
          console.error('[ResultDispatcher] jira comment failed:', e)
        );
      }
      // 'dashboard' is always stored in runs.result — no extra action needed
      // 'draft_mr' is phase 2
    }
  }

  private async postGitLabComment(result: string, payload: Record<string, unknown>): Promise<void> {
    const project = (payload?.['project'] as Record<string, unknown>)?.['path_with_namespace'] as string;
    const mrIid = (payload?.['object_attributes'] as Record<string, unknown>)?.['iid'] as number;
    if (!project || !mrIid || !this.gitlab) return;
    const body = `### Agent Hub Review\n\n${result}`;
    await this.gitlab.postMrComment(project, mrIid, body);
  }

  private async postJiraComment(result: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.jira) return;
    const issueKeyFromIssue = (payload?.['issue'] as Record<string, unknown>)?.['key'] as string | undefined;
    const mrTitle = (payload?.['object_attributes'] as Record<string, unknown>)?.['title'] as string | undefined;
    const issueKey = issueKeyFromIssue ?? mrTitle?.match(/CORE-\d+/)?.[0];
    if (!issueKey) return;
    await this.jira.postComment(issueKey, `### Agent Hub Result\n\n${result}`);
  }
}
