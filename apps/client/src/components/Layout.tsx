import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import InsightsIcon from '@mui/icons-material/Insights';
import DnsIcon from '@mui/icons-material/Dns';
import HubIcon from '@mui/icons-material/Hub';
import PeopleIcon from '@mui/icons-material/People';
import { useNavigate, useLocation } from 'react-router-dom';
import { colors } from './dashboard/palette.js';
import { WorkspaceChip } from './WorkspaceChip.js';
import { SidebarAccount } from './SidebarAccount.js';
import { TeamsStatus } from './TeamsStatus.js';
import { useAuthStore } from '../store/auth.store.js';

const DRAWER_WIDTH = 240;
const BASE_NAV = [
  { label: 'Agents', path: '/', icon: <SmartToyIcon fontSize="small" /> },
  { label: 'Activity', path: '/runs', icon: <InsightsIcon fontSize="small" /> },
  { label: 'Runners', path: '/runners', icon: <DnsIcon fontSize="small" /> },
];
const ADMIN_NAV = [
  { label: 'Users', path: '/users', icon: <PeopleIcon fontSize="small" /> },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const me = useAuthStore(s => s.me);
  const isAdmin = me?.role === 'admin';
  const NAV = isAdmin ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: colors.pageBg }}>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH, flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH, boxSizing: 'border-box',
            bgcolor: colors.card, borderRight: `1px solid ${colors.cardBorder}`,
            display: 'flex', flexDirection: 'column',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 2 }}>
          <Box
            sx={{
              width: 32, height: 32, borderRadius: 2, bgcolor: 'primary.main', color: '#10131c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <HubIcon fontSize="small" />
          </Box>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: colors.text }}>Agent hub</Typography>
        </Box>

        <WorkspaceChip />

        <List sx={{ flex: 1, px: 1 }}>
          {NAV.map((n) => {
            const selected = pathname === n.path;
            return (
              <ListItemButton
                key={n.path}
                selected={selected}
                onClick={() => navigate(n.path)}
                sx={{
                  borderRadius: 2, mb: 0.5, pl: 1.5,
                  borderLeft: '3px solid transparent',
                  '&.Mui-selected': { bgcolor: 'rgba(137,180,250,0.14)', borderLeftColor: 'primary.main' },
                  '&.Mui-selected:hover': { bgcolor: 'rgba(137,180,250,0.20)' },
                }}
              >
                <ListItemIcon sx={{ minWidth: 34, color: selected ? 'primary.main' : colors.textMuted }}>
                  {n.icon}
                </ListItemIcon>
                <ListItemText
                  primary={n.label}
                  primaryTypographyProps={{
                    fontSize: 14,
                    fontWeight: selected ? 600 : 500,
                    color: selected ? colors.text : colors.textMuted,
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>

        <TeamsStatus />
        <SidebarAccount />
      </Drawer>

      <Box component="main" sx={{ flex: 1, p: 3, bgcolor: colors.pageBg, minHeight: '100vh' }}>
        {children}
      </Box>
    </Box>
  );
}
