import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

const EVENT_OPTIONS = ['mr:opened', 'mr:updated', 'mr:merged', 'jira:status:in-progress', 'pipeline:failed'];

interface TriggerRules { events: string[]; branchFilter?: string; jiraLabel?: string; }
interface Props { value: TriggerRules; onChange: (v: TriggerRules) => void; }

export function TriggerRulesForm({ value, onChange }: Props) {
  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Typography variant="subtitle2">Trigger Rules</Typography>
      <Autocomplete
        multiple freeSolo
        options={EVENT_OPTIONS}
        value={value.events}
        onChange={(_, events) => onChange({ ...value, events: events as string[] })}
        renderTags={(v, getTagProps) => v.map((opt, i) => <Chip label={opt} {...getTagProps({ index: i })} key={opt} />)}
        renderInput={params => <TextField {...params} label="Events" placeholder="mr:opened" />}
      />
      <TextField
        label="Branch Filter (optional)"
        value={value.branchFilter ?? ''}
        onChange={e => onChange({ ...value, branchFilter: e.target.value || undefined })}
        placeholder="feature/*"
        size="small"
      />
      <TextField
        label="Jira Label Filter (optional)"
        value={value.jiraLabel ?? ''}
        onChange={e => onChange({ ...value, jiraLabel: e.target.value || undefined })}
        placeholder="checkout-team"
        size="small"
      />
    </Box>
  );
}
