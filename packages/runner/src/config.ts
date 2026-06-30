export interface RunnerConfig {
  orchestratorUrl: string;
  runnerToken: string;
  runnerName: string;
  anthropicApiKey: string;
  localReposRoot: string;
  skillsDir: string;
  workflowsDir: string;
  toolsEnabled: boolean;
}

export function loadConfig(): RunnerConfig {
  const required = (key: string) => {
    const v = process.env[key];
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  };
  return {
    orchestratorUrl: process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000',
    runnerToken: required('RUNNER_TOKEN'),
    runnerName: process.env.RUNNER_NAME ?? 'local-runner',
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    localReposRoot: process.env.LOCAL_REPOS_ROOT ?? 'C:/GlobalE',
    skillsDir: process.env.SKILLS_DIR ?? 'C:/GlobalE/.claude/skills',
    workflowsDir: process.env.WORKFLOWS_DIR ?? 'C:/GlobalE/globale.agent-hub/workflows',
    toolsEnabled: !['false', '0', 'no'].includes((process.env.AGENT_TOOLS_ENABLED ?? '').trim().toLowerCase()),
  };
}
