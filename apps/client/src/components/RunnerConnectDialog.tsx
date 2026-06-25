import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';

export function RunnerConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect a runner</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Runners register themselves with the hub when they start and send a heartbeat.
          Start a runner on the target machine and it will appear here automatically:
        </DialogContentText>
        <Box
          component="pre"
          sx={{
            bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid', borderColor: 'divider',
            borderRadius: 1.5, p: 2, m: 0, fontSize: 13, overflowX: 'auto',
          }}
        >
{`# from the agent-hub repo root
npm run dev:runner`}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
