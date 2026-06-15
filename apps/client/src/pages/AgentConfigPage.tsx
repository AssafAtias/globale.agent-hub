import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Typography from '@mui/material/Typography';
import { api } from '../api/client.js';
import { PromptEditor } from '../components/PromptEditor.js';
import { TriggerRulesForm } from '../components/TriggerRulesForm.js';
import { OutputSelector } from '../components/OutputSelector.js';
import { useQueryClient } from '@tanstack/react-query';

const DEFAULT_RULES = { events: [] as string[], branchFilter: undefined as string | undefined, jiraLabel: undefined as string | undefined };

export function AgentConfigPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new' || !id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [type, setType] = useState<'pr-review' | 'ticket-to-code'>('pr-review');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [prompt, setPrompt] = useState('');
  const [repos, setRepos] = useState('');
  const [triggerRules, setTriggerRules] = useState(DEFAULT_RULES);
  const [outputs, setOutputs] = useState<string[]>(['dashboard']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew && id) {
      api.agents.get(id).then(a => {
        setName(a.name);
        setType(a.type as 'pr-review' | 'ticket-to-code');
        setModel(a.model);
        setPrompt(a.prompt);
        setRepos((JSON.parse(a.repos || '[]') as string[]).join('\n'));
        setTriggerRules(JSON.parse(a.triggerRules || '{}'));
        setOutputs(JSON.parse(a.outputs || '["dashboard"]'));
      });
    }
  }, [id, isNew]);

  async function save() {
    setSaving(true);
    const body: Partial<import('../api/client.js').Agent> = {
      name, type, model, prompt,
      repos: JSON.stringify(repos.split('\n').map(r => r.trim()).filter(Boolean)),
      triggerRules: JSON.stringify(triggerRules),
      outputs: JSON.stringify(outputs),
    };
    try {
      if (isNew) await api.agents.create(body);
      else await api.agents.update(id!, body);
      qc.invalidateQueries({ queryKey: ['agents'] });
      navigate('/');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box maxWidth={640}>
      <Typography variant="h5" gutterBottom>{isNew ? 'New Agent' : 'Edit Agent'}</Typography>
      <Box display="flex" flexDirection="column" gap={3}>
        <TextField label="Name" value={name} onChange={e => setName(e.target.value)} fullWidth />
        <FormControl fullWidth>
          <InputLabel>Type</InputLabel>
          <Select value={type} label="Type" onChange={e => setType(e.target.value as 'pr-review' | 'ticket-to-code')}>
            <MenuItem value="pr-review">PR / MR Review</MenuItem>
            <MenuItem value="ticket-to-code">Ticket to Code</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel>Model</InputLabel>
          <Select value={model} label="Model" onChange={e => setModel(e.target.value)}>
            <MenuItem value="claude-haiku-4-5">claude-haiku-4-5 (fast)</MenuItem>
            <MenuItem value="claude-sonnet-4-6">claude-sonnet-4-6 (balanced)</MenuItem>
            <MenuItem value="claude-opus-4-8">claude-opus-4-8 (deep)</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label="Repos (one per line)" multiline minRows={3} fullWidth
          value={repos} onChange={e => setRepos(e.target.value)}
          placeholder={"gitlab:global-e/checkout-apps\nbitbucket:org/core"}
          helperText="Format: platform:org/repo"
        />
        <PromptEditor value={prompt} onChange={setPrompt} />
        <TriggerRulesForm value={triggerRules} onChange={v => setTriggerRules(v as typeof triggerRules)} />
        <OutputSelector value={outputs} onChange={setOutputs} />
        <Box display="flex" gap={2}>
          <Button variant="outlined" onClick={() => navigate('/')}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !name}>
            {saving ? 'Saving...' : 'Save Agent'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
