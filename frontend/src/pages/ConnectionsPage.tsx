import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Database,
  FileText,
  GitBranch,
  History,
  Loader2,
  Mail,
  MessageSquare,
  NotebookPen,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  isAdmin,
  providerLabel,
  type Connection,
  type SyncRunRow,
} from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Button } from '../ui/Button';
import { Dialog, useConfirm } from '../ui/Dialog';
import { Badge, Card, ErrorNote, PageHeader, Spinner, Table, td, th } from '../ui/Surface';
import { useToast } from '../ui/Toast';

const statusTone = {
  active: 'success',
  syncing: 'accent',
  paused: 'neutral',
  error: 'danger',
  revoked: 'warning',
} as const;

const comingSoon: { name: string; icon: ReactNode; phase: string; text: string }[] = [
  {
    name: 'Google Drive',
    icon: <FileText className="size-5" />,
    phase: 'Next',
    text: 'Docs, Sheets, Slides and PDFs, with Drive sharing permissions.',
  },
  {
    name: 'Slack',
    icon: <MessageSquare className="size-5" />,
    phase: 'Later',
    text: 'Channels and threads; private channels only for their members.',
  },
  {
    name: 'Gmail',
    icon: <Mail className="size-5" />,
    phase: 'Later',
    text: 'Your mail, visible only to you.',
  },
  {
    name: 'Notion',
    icon: <NotebookPen className="size-5" />,
    phase: 'Later',
    text: 'Pages and databases.',
  },
  {
    name: 'GitHub',
    icon: <GitBranch className="size-5" />,
    phase: 'Later',
    text: 'Issues, pull requests and READMEs.',
  },
];

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

function SyncHistory({
  connection,
  onClose,
}: {
  connection: Connection | null;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const runs = useQuery({
    queryKey: ['sync-runs', connection?.id],
    enabled: Boolean(connection),
    queryFn: () =>
      api<{ data: SyncRunRow[] }>(
        `/v1/workspaces/${workspace.id}/connections/${connection!.id}/sync-runs`,
      ),
  });
  return (
    <Dialog
      open={connection !== null}
      onClose={onClose}
      title="Sync history"
      description={connection?.displayName}
      wide
    >
      {runs.isLoading && <Spinner />}
      {runs.data && (
        <div className="-mx-5 mb-5 max-h-96 overflow-y-auto">
          <Table>
            <thead>
              <tr>
                <th className={th}>Started</th>
                <th className={th}>Kind</th>
                <th className={th}>Result</th>
                <th className={th}>Items</th>
                <th className={th}>Chunks embedded / reused</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.data.map((r) => (
                <tr key={r.id}>
                  <td className={td}>{new Date(r.startedAt).toLocaleString()}</td>
                  <td className={td}>{r.kind}</td>
                  <td className={td}>
                    <Badge
                      tone={
                        r.status === 'succeeded'
                          ? 'success'
                          : r.status === 'failed'
                            ? 'danger'
                            : 'accent'
                      }
                    >
                      {r.status}
                    </Badge>
                    {r.error && <p className="mt-1 max-w-xs text-xs text-danger">{r.error}</p>}
                  </td>
                  <td className={td}>
                    {r.itemsUpserted} new · {r.itemsUnchanged} same · {r.itemsDeleted} deleted
                  </td>
                  <td className={td}>
                    {r.chunksEmbedded} / {r.chunksReused}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}

export function ConnectionsPage() {
  const { workspace, me } = useWorkspace();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [history, setHistory] = useState<Connection | null>(null);
  const base = `/v1/workspaces/${workspace.id}/connections`;
  const key = ['connections', workspace.id];
  const admin = isAdmin(workspace.role);

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
  const onError = (err: unknown) =>
    toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');

  const addDemo = useMutation({
    mutationFn: () => api<Connection>(`${base}/demo`, { method: 'POST' }),
    onSuccess: () => toast('Demo data added; indexing started'),
    onError,
    onSettled: refresh,
  });
  const sync = useMutation({
    mutationFn: (v: { id: string; kind: 'incremental' | 'full' }) =>
      api(`${base}/${v.id}/sync`, { method: 'POST', body: JSON.stringify({ kind: v.kind }) }),
    onSuccess: () => toast('Sync started'),
    onError,
    onSettled: refresh,
  });
  const update = useMutation({
    mutationFn: (v: {
      id: string;
      body: { paused?: boolean; visibility?: 'personal' | 'workspace' };
    }) => api<Connection>(`${base}/${v.id}`, { method: 'PATCH', body: JSON.stringify(v.body) }),
    onError,
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast('Disconnected'),
    onError,
    onSettled: refresh,
  });

  const list = connections.data?.data ?? [];
  const hasDemo = list.some((c) => c.provider === 'demo');

  return (
    <div>
      <PageHeader
        title="Connections"
        description="The apps Findr searches. Each person only sees what they can see in the original app."
      />

      {connections.isLoading && <Spinner />}
      {connections.isError && <ErrorNote>Couldn't load connections.</ErrorNote>}

      <div className="flex flex-col gap-3">
        {list.map((c) => {
          const canManage = c.isOwner || admin;
          const busy = c.status === 'syncing' || c.lastRun?.status === 'running' || !c.lastRun;
          return (
            <Card key={c.id} className="p-5">
              <div className="flex flex-wrap items-start gap-4">
                <span
                  className="flex size-10 items-center justify-center rounded-md bg-accent-soft text-accent"
                  aria-hidden
                >
                  <Database className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{c.displayName}</h2>
                    <Badge tone={statusTone[c.status]}>
                      {busy && c.status !== 'paused' && (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      )}
                      {c.status}
                    </Badge>
                    <Badge>
                      {c.visibility === 'workspace' ? (
                        <Users className="size-3" aria-hidden />
                      ) : null}
                      {c.visibility === 'workspace' ? 'Shared with workspace' : 'Personal'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {providerLabel[c.provider] ?? c.provider} · {c.documentCount} documents ·{' '}
                    {c.chunkCount} chunks · last sync{' '}
                    {when(c.lastIncrementalSyncAt ?? c.lastFullSyncAt)}
                  </p>
                  {c.lastRun && (
                    <p className="mt-1 text-xs text-muted">
                      Last run ({c.lastRun.kind}, {c.lastRun.status}): {c.lastRun.itemsUpserted}{' '}
                      indexed, {c.lastRun.itemsUnchanged} unchanged, {c.lastRun.itemsDeleted}{' '}
                      deleted · {c.lastRun.chunksEmbedded} chunks embedded, {c.lastRun.chunksReused}{' '}
                      reused
                    </p>
                  )}
                  {c.status === 'error' && c.errorMessage && (
                    <p className="mt-2 text-sm text-danger">{c.errorMessage}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {canManage && (
                  <>
                    <Button
                      size="sm"
                      icon={<RefreshCw className="size-3.5" />}
                      disabled={busy || c.status === 'paused'}
                      onClick={() => sync.mutate({ id: c.id, kind: 'incremental' })}
                    >
                      Sync now
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || c.status === 'paused'}
                      onClick={() => sync.mutate({ id: c.id, kind: 'full' })}
                    >
                      Full resync
                    </Button>
                    <Button
                      size="sm"
                      icon={
                        c.status === 'paused' ? (
                          <Play className="size-3.5" />
                        ) : (
                          <Pause className="size-3.5" />
                        )
                      }
                      onClick={() =>
                        update.mutate({ id: c.id, body: { paused: c.status !== 'paused' } })
                      }
                    >
                      {c.status === 'paused' ? 'Resume' : 'Pause'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        update.mutate({
                          id: c.id,
                          body: {
                            visibility: c.visibility === 'workspace' ? 'personal' : 'workspace',
                          },
                        })
                      }
                    >
                      {c.visibility === 'workspace' ? 'Make personal' : 'Share with workspace'}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<History className="size-3.5" />}
                  onClick={() => setHistory(c)}
                >
                  History
                </Button>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    icon={<Trash2 className="size-3.5" />}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Disconnect ${c.displayName}?`,
                        description:
                          'Everything indexed from it is deleted from Findr. The original app is not affected.',
                        confirmLabel: 'Disconnect',
                        danger: true,
                      });
                      if (ok) remove.mutate(c.id);
                    }}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold">Add a connection</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col p-4">
          <div className="flex items-center gap-3">
            <span
              className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent"
              aria-hidden
            >
              <Database className="size-5" />
            </span>
            <span className="font-medium">Demo data</span>
          </div>
          <p className="mt-2 flex-1 text-sm text-muted">
            A fictional company, Tamarind Labs: 82 emails, docs and Slack threads. Shared with the
            workspace.
          </p>
          <Button
            className="mt-4"
            variant="primary"
            size="sm"
            loading={addDemo.isPending}
            disabled={hasDemo}
            onClick={() => addDemo.mutate()}
          >
            {hasDemo ? 'Connected' : 'Connect'}
          </Button>
        </Card>
        {comingSoon.map((s) => (
          <Card key={s.name} className="flex flex-col p-4 opacity-75">
            <div className="flex items-center gap-3">
              <span
                className="flex size-9 items-center justify-center rounded-md bg-surface-2 text-muted"
                aria-hidden
              >
                {s.icon}
              </span>
              <span className="font-medium">{s.name}</span>
              <Badge>{s.phase === 'Next' ? 'Coming next' : 'Coming later'}</Badge>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{s.text}</p>
            <Button className="mt-4" size="sm" disabled>
              Not available yet
            </Button>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Signed in as {me.user.email}.</p>

      <SyncHistory connection={history} onClose={() => setHistory(null)} />
    </div>
  );
}
