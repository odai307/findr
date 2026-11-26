import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { api, type Me, type Workspace } from './api';

const STORAGE_KEY = 'findr.workspaceId';

interface WorkspaceContextValue {
  me: Me;
  workspace: Workspace;
  setWorkspaceId(id: string): void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Loads the current user and remembers which workspace they're working in (per browser). */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') });
  const [selected, setSelected] = useState<string | null>(readStored);

  if (me.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  if (me.isError || !me.data) {
    return <div className="p-8 text-sm text-danger">Couldn't load your account.</div>;
  }

  const workspaces = me.data.workspaces;
  const workspace = workspaces.find((w) => w.id === selected) ?? workspaces[0];
  if (!workspace) return <div className="p-8 text-sm text-muted">You have no workspaces.</div>;

  const setWorkspaceId = (id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage unavailable (private mode): the choice lasts for this page view only.
    }
  };

  return (
    <WorkspaceContext.Provider value={{ me: me.data, workspace, setWorkspaceId }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
