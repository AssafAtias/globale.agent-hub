import { createTheme } from '@mui/material/styles';
import { colors } from './components/dashboard/palette.js';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#89b4fa' },
    info: { main: '#5b9bff' },
    success: { main: '#4ade80' },
    warning: { main: '#e6b65c' },
    error: { main: '#f0706f' },
    background: { default: colors.pageBg, paper: colors.card },
    divider: colors.cardBorder,
    text: { primary: colors.text, secondary: colors.textMuted },
  },
  typography: { fontFamily: '"Inter", "Roboto", sans-serif' },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: colors.card,
          backgroundImage: 'none',
          border: `1px solid ${colors.cardBorder}`,
          borderRadius: 12,
        },
      },
    },
  },
});
