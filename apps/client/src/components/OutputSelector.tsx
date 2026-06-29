import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';

const OPTIONS = [
  { value: 'dashboard', label: 'Dashboard (always stored)' },
  { value: 'pr_comment', label: 'Post comment on PR/MR' },
  { value: 'jira', label: 'Post comment on Jira ticket' },
  { value: 'draft_mr', label: 'Open draft MR with generated code' },
  { value: 'teams', label: 'Post result to Microsoft Teams' },
];

interface Props { value: string[]; onChange: (v: string[]) => void; }

export function OutputSelector({ value, onChange }: Props) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter(o => o !== opt) : [...value, opt]);

  return (
    <>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Outputs</Typography>
      <FormGroup>
        {OPTIONS.map(o => (
          <FormControlLabel
            key={o.value}
            control={<Checkbox checked={value.includes(o.value)} onChange={() => toggle(o.value)} />}
            label={o.label}
          />
        ))}
      </FormGroup>
    </>
  );
}
