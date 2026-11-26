import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Check,
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  Monitor,
  Moon,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  User,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, isAdmin, logout, type Workspace } from '../lib/api';
import { cn } from '../lib/cn';
import { useTheme, type ThemeSetting } from '../lib/theme';
import { useWorkspace } from '../lib/workspace';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu';
import { Avatar } from '../ui/Surface';
import { useToast } from '../ui/Toast';

function NavItem({
  to,
  icon,
  children,
  end,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm',
          isActive
            ? 'bg-surface-2 font-medium text-fg'
            : 'text-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      <span className="size-4 [&>svg]:size-4" aria-hidden>
        {icon}
      </span>
      {children}
    </NavLink>
  );
}

function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const { setWorkspaceId } = useWorkspace();
  const toast = useToast();
  const create = useMutation({
    mutationFn: (n: string) =>
      api<Workspace>('/v1/workspaces', { method: 'POST', body: JSON.stringify({ name: n }) }),
    onSuccess: (ws) => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      setWorkspaceId(ws.id);
      toast(`Created ${ws.name}`);
      setName('');
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a workspace"
      description="A workspace has its own connections, members and search index."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-5">
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Acme Inc."
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function WorkspaceSwitcher() {
  const { me, workspace, setWorkspaceId } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <Menu
        label="Switch workspace"
        trigger={
          <span className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
            <span className="flex size-6 items-center justify-center rounded bg-accent text-xs font-bold text-accent-fg">
              {workspace.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{workspace.name}</span>
              <span className="block text-xs text-muted capitalize">{workspace.role}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted" aria-hidden />
          </span>
        }
      >
        {(close) => (
          <>
            <MenuLabel>Workspaces</MenuLabel>
            {me.workspaces.map((w) => (
              <MenuItem
                key={w.id}
                active={w.id === workspace.id}
                icon={w.id === workspace.id ? <Check className="size-4" /> : null}
                onSelect={() => {
                  setWorkspaceId(w.id);
                  navigate('/');
                  close();
                }}
              >
                {w.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              icon={<Plus className="size-4" />}
              onSelect={() => {
                setCreating(true);
                close();
              }}
            >
              Create workspace
            </MenuItem>
          </>
        )}
      </Menu>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function UserMenu() {
  const { me } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const themes: { value: ThemeSetting; label: string; icon: ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
  ];
  return (
    <Menu
      label="Account menu"
      side="top"
      trigger={
        <span className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
          <Avatar name={me.user.name} src={me.user.avatarUrl} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{me.user.name}</span>
            <span className="block truncate text-xs text-muted">{me.user.email}</span>
          </span>
        </span>
      }
    >
      {(close) => (
        <>
          <MenuItem
            icon={<User className="size-4" />}
            onSelect={() => {
              navigate('/account');
              close();
            }}
          >
            Account
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Theme</MenuLabel>
          {themes.map((t) => (
            <MenuItem
              key={t.value}
              icon={theme === t.value ? <Check className="size-4" /> : t.icon}
              active={theme === t.value}
              onSelect={() => setTheme(t.value)}
            >
              {t.label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<LogOut className="size-4" />}
            onSelect={() => {
              close();
              void logout().then(() => queryClient.clear());
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function SidebarContent() {
  const { workspace } = useWorkspace();
  const admin = isAdmin(workspace.role);
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <WorkspaceSwitcher />
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <NavItem to="/" end icon={<Search />}>
          Search
        </NavItem>
        <NavItem to="/conversations" icon={<MessageSquare />}>
          Ask
        </NavItem>
        <NavItem to="/connections" icon={<Plug />}>
          Connections
        </NavItem>
      </nav>
      <nav aria-label="Workspace settings" className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-xs font-medium text-muted">Workspace</p>
        <NavItem to="/settings/workspace" icon={<Settings />}>
          Settings
        </NavItem>
        <NavItem to="/settings/members" icon={<Users />}>
          Members
        </NavItem>
        {admin && (
          <>
            <NavItem to="/settings/api-keys" icon={<KeyRound />}>
              API keys
            </NavItem>
            <NavItem to="/settings/usage" icon={<BarChart3 />}>
              Usage
            </NavItem>
            <NavItem to="/admin" icon={<ShieldCheck />}>
              Admin
            </NavItem>
          </>
        )}
      </nav>
      <div className="mt-auto">
        <UserMenu />
      </div>
    </div>
  );
}

/**
 * The signed-in layout: a sidebar on wide screens, a top bar with a slide-over menu on phones.
 * Ctrl/Cmd+K anywhere jumps to the search box.
 */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const [lastPath, setLastPath] = useState(location.pathname);

  // Close the phone menu after navigating (adjusting state during render, not in an effect).
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (location.pathname === '/') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/', { state: { focus: true } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [location.pathname, navigate]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-surface focus:p-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface md:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="rounded p-1.5 text-muted hover:bg-surface-2"
        >
          <MenuIcon className="size-5" />
        </button>
        <span className="truncate text-sm font-semibold">{workspace.name}</span>
      </header>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-surface shadow-xl">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 rounded p-1 text-muted hover:bg-surface-2"
            >
              <X className="size-4" />
            </button>
            <SidebarContent />
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
