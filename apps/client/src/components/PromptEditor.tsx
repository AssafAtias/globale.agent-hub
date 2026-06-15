import TextField from '@mui/material/TextField';

interface Props { value: string; onChange: (v: string) => void; }

export function PromptEditor({ value, onChange }: Props) {
  return (
    <TextField
      label="System Prompt"
      multiline minRows={6} fullWidth
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="You are a code reviewer. Review the MR diff and report: Blockers, Issues, Notes. Be concise."
      helperText="Instructions Claude follows when this agent runs."
    />
  );
}
