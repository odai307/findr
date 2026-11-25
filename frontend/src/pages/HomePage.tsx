import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, logout, type Me, type Workspace } from '../lib/api';

/** Phase 0 home: who you are and your workspaces. The search bar arrives in phase 2. */
export function HomePage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') });
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: (workspaceName: string) =>
      api<Workspace>('/v1/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: workspaceName }),
      }),
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  }

  if (me.isLoading) return <div className="p-8 text-sm text-zinc-500">Loading…</div>;
  if (me.isError || !me.data)
    return <div className="p-8 text-sm text-red-600">Couldn't load your account.</div>;

  const { user, workspaces } = me.data;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Findr</h1>
        <div className="flex items-center gap-3 text-sm">
          {user.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-7 w-7 rounded-full"
              referrerPolicy="no-referrer"
            />
          )}
          <span className="text-zinc-600 dark:text-zinc-400">{user.email}</span>
          <button
            onClick={() => {
              void logout().then(() => queryClient.clear());
            }}
            className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your workspaces
        </h2>
        <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {workspaces.map((ws) => (
            <li key={ws.id} className="flex items-center justify-between px-4 py-3">
              <span className="font-medium">{ws.name}</span>
              <span className="text-xs text-zinc-500">{ws.role}</span>
            </li>
          ))}
        </ul>

        <form onSubmit={onCreate} className="mt-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New workspace name"
            maxLength={80}
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            Create
          </button>
        </form>
      </section>

      <p className="mt-12 text-center text-sm text-zinc-500">Search arrives in phase 2.</p>
    </main>
  );
}
