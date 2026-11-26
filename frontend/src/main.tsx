import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import './index.css';
import { AppShell } from './components/AppShell';
import { AuthProvider, useAuthStatus } from './lib/auth';
import { peekNext, rememberNext, safeNext } from './lib/next';
import { applyTheme, readTheme, ThemeProvider } from './lib/theme';
import { WorkspaceProvider } from './lib/workspace';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { MembersPage } from './pages/MembersPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SearchPage } from './pages/SearchPage';
import { UsagePage } from './pages/UsagePage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';
import { ConfirmProvider } from './ui/Dialog';
import { Spinner } from './ui/Surface';
import { ToastProvider } from './ui/Toast';

// Apply the saved theme before the first paint, so there's no light flash in dark mode.
applyTheme(readTheme());

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

/**
 * After Google sign-in the browser lands on "/", so send the user on to where they were going
 * (e.g. an invite link), once.
 */
function ResumeAfterSignIn({ children }: { children: ReactNode }) {
  const location = useLocation();
  const target = peekNext();
  useEffect(() => {
    if (target) rememberNext(null);
  }, [target]);
  if (target && target !== location.pathname) return <Navigate to={target} replace />;
  return children;
}

/** Signed-in pages. Signed-out visitors go to /login and come back here afterwards. */
function Protected({ children }: { children: ReactNode }) {
  const status = useAuthStatus();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signed-out') {
    const next = `${location.pathname}${location.search}`;
    return (
      <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
    );
  }
  return <ResumeAfterSignIn>{children}</ResumeAfterSignIn>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const status = useAuthStatus();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signed-in') {
    const next = safeNext(new URLSearchParams(location.search).get('next'));
    return <Navigate to={next ?? '/'} replace />;
  }
  return children;
}

const inWorkspace = (page: ReactNode) => (
  <Protected>
    <WorkspaceProvider>{page}</WorkspaceProvider>
  </Protected>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
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
                  <Route path="/invite/:token" element={inWorkspace(<InvitePage />)} />
                  <Route path="/welcome" element={inWorkspace(<OnboardingPage />)} />
                  <Route element={inWorkspace(<AppShell />)}>
                    <Route index element={<SearchPage />} />
                    <Route path="conversations" element={<ConversationsPage />} />
                    <Route path="conversations/:conversationId" element={<ConversationsPage />} />
                    <Route path="connections" element={<ConnectionsPage />} />
                    <Route
                      path="settings"
                      element={<Navigate to="/settings/workspace" replace />}
                    />
                    <Route path="settings/workspace" element={<WorkspaceSettingsPage />} />
                    <Route path="settings/members" element={<MembersPage />} />
                    <Route path="settings/api-keys" element={<ApiKeysPage />} />
                    <Route path="settings/usage" element={<UsagePage />} />
                    <Route path="admin" element={<AdminPage />} />
                    <Route path="account" element={<AccountPage />} />
                    <Route
                      path="workspaces"
                      element={<Navigate to="/settings/workspace" replace />}
                    />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
