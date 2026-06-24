import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { SKILL_CATALOG, dedupeSkills } from '../constants/skills.js';

interface Props { value: string[]; onChange: (skills: string[]) => void; }

export function SkillsSelector({ value, onChange }: Props) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={SKILL_CATALOG}
      value={value}
      onChange={(_, next) => onChange(dedupeSkills(next as string[]))}
      renderInput={(params) => (
        <TextField {...params} label="Skills" placeholder="Add a skill" />
      )}
    />
  );
}
