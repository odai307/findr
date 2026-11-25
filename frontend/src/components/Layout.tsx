import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { logout } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm ${
    isActive
      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
  }`;

export function Layout() {
  const queryClient = useQueryClient();
  const { me, workspace, setWorkspaceId } = useWorkspace();

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="mr-2 text-lg font-semibold tracking-tight">Findr</span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>
              Search
            </NavLink>
            <NavLink to="/connections" className={navClass}>
              Connections
            </NavLink>
            <NavLink to="/workspaces" className={navClass}>
              Workspaces
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <label className="sr-only" htmlFor="workspace">
              Workspace
            </label>
            <select
              id="workspace"
              value={workspace.id}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="max-w-44 rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {me.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            {me.user.avatarUrl && (
              <img
                src={me.user.avatarUrl}
                alt=""
                className="h-7 w-7 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="hidden text-zinc-600 sm:inline dark:text-zinc-400">
              {me.user.email}
            </span>
            <button
              onClick={() => {
                void logout().then(() => queryClient.clear());
              }}
              className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
