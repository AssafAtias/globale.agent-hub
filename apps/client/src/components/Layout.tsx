import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { useNavigate, useLocation } from 'react-router-dom';

const DRAWER_WIDTH = 220;
const NAV = [
  { label: 'Agents', path: '/' },
  { label: 'Run History', path: '/runs' },
  { label: 'Runners', path: '/runners' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer variant="permanent" sx={{ width: DRAWER_WIDTH, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" color="primary">Agent Hub</Typography>
        </Box>
        <List dense>
          {NAV.map(n => (
            <ListItemButton key={n.path} selected={pathname === n.path} onClick={() => navigate(n.path)}>
              <ListItemText primary={n.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flex: 1, p: 3 }}>
        {children}
      </Box>
    </Box>
  );
}
