export interface ToolArgsOptions {
  enabled: boolean;
  repoPaths: string[];
}

// Read-only built-ins + read-only git subcommands only.
const ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob',
  'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git status:*)',
  'Bash(git blame:*)', 'Bash(git ls-files:*)', 'Bash(git branch:*)', 'Bash(git rev-parse:*)',
];
const DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// The spawn uses shell:true, so tokens with spaces/parens/globs/colons must be
// double-quoted (the shell strips the quotes before the arg reaches `claude`).
const q = (s: string): string => `"${s}"`;

export function buildToolArgs({ enabled, repoPaths }: ToolArgsOptions): string[] {
  if (!enabled) return [];
  const args: string[] = [
    '--permission-mode', 'dontAsk',
    '--allowedTools', ...ALLOWED_TOOLS.map(q),
    '--disallowedTools', ...DISALLOWED_TOOLS.map(q),
  ];
  for (const path of repoPaths.slice(1)) {
    args.push('--add-dir', q(path));
  }
  return args;
}
