import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useSkills } from '../hooks/useSkills.js';
import { dedupeSkills } from '../constants/skills.js';
import type { SkillSummary } from '../api/client.js';

interface Props { value: string[]; onChange: (skills: string[]) => void; }

type SkillOption = SkillSummary | string;

function optionName(o: SkillOption): string {
  return typeof o === 'string' ? o : o.name;
}

export function SkillsSelector({ value, onChange }: Props) {
  const { data: catalog, isLoading } = useSkills();
  const options: SkillOption[] = catalog ?? [];

  return (
    <Autocomplete<SkillOption, true>
      multiple
      options={options}
      loading={isLoading}
      // value is a string[] of skill names; map to/from catalog objects
      value={value}
      isOptionEqualToValue={(option, val) => optionName(option) === optionName(val)}
      getOptionLabel={optionName}
      filterOptions={(opts, state) => {
        const q = state.inputValue.toLowerCase();
        if (!q) return opts;
        return opts.filter((o) => {
          if (typeof o === 'string') return o.toLowerCase().includes(q);
          return o.name.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q);
        });
      }}
      onChange={(_, next) =>
        onChange(dedupeSkills(next.map(optionName)))
      }
      renderOption={(props, option) => {
        const name = optionName(option);
        const description = typeof option === 'string' ? undefined : option.description;
        return (
          <Box component="li" {...props} key={name}>
            <Box>
              <Typography variant="body2">{name}</Typography>
              {description && (
                <Typography variant="caption" color="text.secondary">{description}</Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label="Skills" placeholder="Search skills" />
      )}
    />
  );
}
