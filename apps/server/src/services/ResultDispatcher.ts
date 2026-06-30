import { GitLabClient } from './GitLabClient.js';
import { JiraClient } from './JiraClient.js';
import { BitbucketClient } from './BitbucketClient.js';
import { formatTeamsResult } from './teams/TeamsNotifier.js';
import type { AgentRow } from './AgentRepository.js';
import type { RunRow } from './RunRepository.js';

interface TeamsNotifierLike { post(ref: object, text: string): Promise<void>; }
interface TeamsWebhookLike { postResult(agentName: string, status: 'done' | 'failed', body: string): Promise<void>; }

export class ResultDispatcher {
  private gitlab?: GitLabClient;
  private jira?: JiraClient;
  private teams?: TeamsNotifierLike;
  private teamsWebhook?: TeamsWebhookLike;
  private bitbucket?: BitbucketClient;

  constructor(gitlabToken?: string, jiraToken?: string, jiraBaseUrl?: string, jiraEmail?: string, teamsNotifier?: TeamsNotifierLike, teamsWebhook?: TeamsWebhookLike, bitbucketToken?: string, bitbucketUsername?: string) {
    if (gitlabToken) this.gitlab = new GitLabClient(gitlabToken);
    if (jiraToken && jiraBaseUrl) this.jira = new JiraClient(jiraToken, jiraBaseUrl, jiraEmail);
    this.teams = teamsNotifier;
    this.teamsWebhook = teamsWebhook;
    if (bitbucketToken) this.bitbucket = new BitbucketClient(bitbucketToken, bitbucketUsername);
  }

  async dispatch(run: RunRow, agent: AgentRow): Promise<void> {
    if (!run.result) return;
    const outputs = (() => { try { return JSON.parse(agent.outputs || '[]') as string[]; } catch { return [] as string[]; } })();
    const payload = (() => { try { return JSON.parse(run.triggerPayload || '{}'); } catch { return {}; } })();

    for (const output of outputs) {
      if (output === 'pr_comment') {
        await this.postPrComment(run.result, payload).catch(e =>
          console.error('[ResultDispatcher] pr_comment failed:', e)
        );
      }
      if (output === 'jira' && this.jira) {
        await this.postJiraComment(run.result, payload).catch(e =>
          console.error('[ResultDispatcher] jira comment failed:', e)
        );
      }
      if (output === 'teams' && this.teams) {
        await this.postTeams(run, agent).catch(e =>
          console.error('[ResultDispatcher] teams failed:', e)
        );
      }
      if (output === 'teams_webhook' && this.teamsWebhook && run.result) {
        await this.teamsWebhook.postResult(agent.name, 'done', run.result)
          .catch(e => console.error('[ResultDispatcher] teams_webhook failed:', e));
      }
      // 'dashboard' is always stored in runs.result — no extra action needed
      // 'draft_mr' is phase 2
    }
  }

  private async postTeams(run: RunRow, agent: AgentRow): Promise<void> {
    if (!this.teams || !run.result) return;
    const refJson = run.replyTo ?? agent.teamsTarget;
    if (!refJson) {
      console.warn('[ResultDispatcher] teams output set but no target for agent', agent.id);
      return;
    }
    await this.teams.post(JSON.parse(refJson), formatTeamsResult(run.result, agent.name));
  }

  private async postPrComment(result: string, payload: Record<string, unknown>): Promise<void> {
    const isGitLab = (payload?.['object_attributes'] as Record<string, unknown>)?.['iid'] != null;
    if (isGitLab && this.gitlab) { await this.postGitLabComment(result, payload); return; }
    if (payload?.['pullrequest'] && this.bitbucket) { await this.postBitbucketComment(result, payload); return; }
    console.warn('[ResultDispatcher] pr_comment: no matching platform client for payload shape');
  }

  private async postGitLabComment(result: string, payload: Record<string, unknown>): Promise<void> {
    const project = (payload?.['project'] as Record<string, unknown>)?.['path_with_namespace'] as string;
    const mrIid = (payload?.['object_attributes'] as Record<string, unknown>)?.['iid'] as number;
    if (!project || !mrIid || !this.gitlab) return;
    const body = `### Agent Hub Review\n\n${result}`;
    await this.gitlab.postMrComment(project, mrIid, body);
  }

  private async postBitbucketComment(result: string, payload: Record<string, unknown>): Promise<void> {
    const repo = (payload?.['repository'] as Record<string, unknown>)?.['full_name'] as string;
    const prId = (payload?.['pullrequest'] as Record<string, unknown>)?.['id'] as number;
    if (!repo || prId == null || !this.bitbucket) return;
    await this.bitbucket.postPrComment(repo, prId, `### Agent Hub Review\n\n${result}`);
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
