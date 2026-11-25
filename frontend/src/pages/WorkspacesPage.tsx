import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, type Workspace } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export function WorkspacesPage() {
  const queryClient = useQueryClient();
  const { me, workspace: current, setWorkspaceId } = useWorkspace();
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: (workspaceName: string) =>
      api<Workspace>('/v1/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: workspaceName }),
      }),
    onSuccess: (ws) => {
      setName('');
      setWorkspaceId(ws.id);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Workspaces</h1>
      <ul className="mt-4 divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {me.workspaces.map((ws) => (
          <li key={ws.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="font-medium">{ws.name}</span>
            <span className="flex items-center gap-3 text-xs text-zinc-500">
              {ws.role}
              {ws.id === current.id ? (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">current</span>
              ) : (
                <button onClick={() => setWorkspaceId(ws.id)} className="underline">
                  Switch
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <form onSubmit={onCreate} className="mt-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New workspace name"
          aria-label="New workspace name"
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
    </div>
  );
}
