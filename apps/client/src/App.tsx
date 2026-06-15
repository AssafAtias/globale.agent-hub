import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme.js';
import { Layout } from './components/Layout.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { AgentConfigPage } from './pages/AgentConfigPage.js';
import { RunHistoryPage } from './pages/RunHistoryPage.js';
import { RunDetailPage } from './pages/RunDetailPage.js';
import { RunnersPage } from './pages/RunnersPage.js';

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
              <Route path="/agents/:id" element={<AgentConfigPage />} />
              <Route path="/runs" element={<RunHistoryPage />} />
              <Route path="/runs/:id" element={<RunDetailPage />} />
              <Route path="/runners" element={<RunnersPage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
