import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#89b4fa' },
    background: { default: '#1e1e2e', paper: '#181825' },
  },
  typography: { fontFamily: '"Inter", "Roboto", sans-serif' },
});
