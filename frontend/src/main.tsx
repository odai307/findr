import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import './index.css';
import { Layout } from './components/Layout';
import { AuthProvider, useAuthStatus } from './lib/auth';
import { WorkspaceProvider } from './lib/workspace';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { LoginPage } from './pages/LoginPage';
import { SearchPage } from './pages/SearchPage';
import { WorkspacesPage } from './pages/WorkspacesPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Protected({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();
  if (status === 'loading') return <div className="p-8 text-sm text-zinc-500">Loading…</div>;
  if (status === 'signed-out') return <Navigate to="/login" replace />;
  return children;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();
  if (status === 'loading') return <div className="p-8 text-sm text-zinc-500">Loading…</div>;
  if (status === 'signed-in') return <Navigate to="/" replace />;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
            <Route
              element={
                <Protected>
                  <WorkspaceProvider>
                    <Layout />
                  </WorkspaceProvider>
                </Protected>
              }
            >
              <Route index element={<SearchPage />} />
              <Route path="connections" element={<ConnectionsPage />} />
              <Route path="workspaces" element={<WorkspacesPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
