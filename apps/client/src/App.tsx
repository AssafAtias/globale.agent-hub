import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme.js';
import { Layout } from './components/Layout.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { AgentConfigPage } from './pages/AgentConfigPage.js';
import { MonitoringDashboard } from './pages/MonitoringDashboard.js';
import { RunDetailPage } from './pages/RunDetailPage.js';
import { RunnersPage } from './pages/RunnersPage.js';
import { AgentProfilePage } from './pages/AgentProfilePage.js';
import { UsersPage } from './pages/UsersPage.js';

const qc = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<AgentsPage />} />
              <Route path="/agents/new" element={<AgentConfigPage />} />
              <Route path="/agents/:id/edit" element={<AgentConfigPage />} />
              <Route path="/agents/:id" element={<AgentProfilePage />} />
              <Route path="/runs" element={<MonitoringDashboard />} />
              <Route path="/runs/:id" element={<RunDetailPage />} />
              <Route path="/runners" element={<RunnersPage />} />
              <Route path="/users" element={<UsersPage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
