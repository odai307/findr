import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Connection } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

const statusStyles: Record<Connection['status'], string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  syncing: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  paused: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  revoked: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

export function ConnectionsPage() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const base = `/v1/workspaces/${workspace.id}/connections`;
  const key = ['connections', workspace.id];

  const connections = useQuery({
    queryKey: key,
    queryFn: () => api<{ data: Connection[] }>(base),
    // Poll every 3 s while a sync is queued or running, so progress shows up live.
    refetchInterval: (q) =>
      q.state.data?.data.some(
        (c) => c.status === 'syncing' || !c.lastRun || c.lastRun.status === 'running',
      )
        ? 3000
        : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const addDemo = useMutation({
    mutationFn: () => api<Connection>(`${base}/demo`, { method: 'POST' }),
    onSettled: refresh,
  });
  const sync = useMutation({
    mutationFn: (v: { id: string; kind: 'incremental' | 'full' }) =>
      api(`${base}/${v.id}/sync`, { method: 'POST', body: JSON.stringify({ kind: v.kind }) }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSettled: refresh,
  });

  const list = connections.data?.data ?? [];
  const hasDemo = list.some((c) => c.provider === 'demo');
  const error = [addDemo.error, sync.error, remove.error].find(Boolean);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Connections</h1>
        {!hasDemo && connections.isSuccess && (
          <button
            onClick={() => addDemo.mutate()}
            disabled={addDemo.isPending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            Add demo data
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Google Drive, Slack and Gmail arrive in later phases. The demo data is a fictional company,
        Tamarind Labs.
      </p>

      {error && (
        <p className="mt-4 text-sm text-red-600">
          {error instanceof ApiError ? error.message : 'Something went wrong.'}
        </p>
      )}
      {connections.isLoading && <p className="mt-6 text-sm text-zinc-500">Loading…</p>}
      {connections.isSuccess && list.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500">No connections yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-4">
        {list.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.displayName}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusStyles[c.status]}`}
              >
                {c.status}
              </span>
              <span className="text-xs text-zinc-500">
                {c.visibility === 'workspace' ? 'shared with workspace' : 'personal'}
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-zinc-500">Documents</dt>
                <dd>{c.documentCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Chunks</dt>
                <dd>{c.chunkCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Last full sync</dt>
                <dd>{when(c.lastFullSyncAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Last incremental</dt>
                <dd>{when(c.lastIncrementalSyncAt)}</dd>
              </div>
            </dl>

            {c.lastRun && (
              <p className="mt-3 text-xs text-zinc-500">
                Last run ({c.lastRun.kind}, {c.lastRun.status}): {c.lastRun.itemsSeen} items seen,{' '}
                {c.lastRun.itemsUpserted} indexed, {c.lastRun.itemsUnchanged} unchanged,{' '}
                {c.lastRun.itemsDeleted} deleted · {c.lastRun.chunksEmbedded} chunks embedded,{' '}
                {c.lastRun.chunksReused} reused
              </p>
            )}
            {c.errorMessage && c.status === 'error' && (
              <p className="mt-2 text-sm text-red-600">{c.errorMessage}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <button
                onClick={() => sync.mutate({ id: c.id, kind: 'incremental' })}
                disabled={c.status === 'syncing'}
                className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Sync now
              </button>
              <button
                onClick={() => sync.mutate({ id: c.id, kind: 'full' })}
                disabled={c.status === 'syncing'}
                className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Full resync
              </button>
              <button
                onClick={() => {
                  if (confirm(`Disconnect ${c.displayName}? All of its indexed data is deleted.`)) {
                    remove.mutate(c.id);
                  }
                }}
                className="rounded-md border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                Disconnect
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
