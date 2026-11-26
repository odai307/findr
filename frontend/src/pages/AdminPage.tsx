import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminOnly } from '../components/AdminOnly';
import { api, providerLabel, type AuditEntry, type SyncRunRow } from '../lib/api';
import { cn } from '../lib/cn';
import { useWorkspace } from '../lib/workspace';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import {
  Badge,
  Card,
  CardHeader,
  ErrorNote,
  PageHeader,
  Spinner,
  Table,
  td,
  th,
} from '../ui/Surface';

const actionLabels: Record<string, string> = {
  'auth.login.google': 'Signed in with Google',
  'auth.login.dev': 'Signed in (dev)',
  'auth.logout_all': 'Signed out everywhere',
  'invite.created': 'Created an invite',
  'invite.accepted': 'Accepted an invite',
  'invite.revoked': 'Revoked an invite',
  'member.role_changed': 'Changed a role',
  'member.removed': 'Removed a member',
  'member.left': 'Left the workspace',
  'connection.created': 'Added a connection',
  'connection.updated': 'Changed a connection',
  'connection.deleted': 'Disconnected a connection',
  'api_key.created': 'Created an API key',
  'api_key.revoked': 'Revoked an API key',
  'workspace.renamed': 'Renamed the workspace',
};
const filters = [
  { value: '', label: 'All activity' },
  { value: 'member.', label: 'Members' },
  { value: 'invite.', label: 'Invites' },
  { value: 'connection.', label: 'Connections' },
  { value: 'api_key.', label: 'API keys' },
  { value: 'workspace.', label: 'Workspace' },
];

function SyncRuns() {
  const { workspace } = useWorkspace();
  const [failedOnly, setFailedOnly] = useState(false);
  const runs = useQuery({
    queryKey: ['admin-sync-runs', workspace.id, failedOnly],
    queryFn: () =>
      api<{ data: SyncRunRow[] }>(`/v1/workspaces/${workspace.id}/sync-runs?failed=${failedOnly}`),
  });
  return (
    <Card>
      <CardHeader
        title="Sync runs"
        description="The latest syncs across all connections."
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={failedOnly}
              onChange={(e) => setFailedOnly(e.target.checked)}
            />
            Failed only
          </label>
        }
      />
      {runs.isLoading && (
        <div className="px-5">
          <Spinner />
        </div>
      )}
      {runs.data?.data.length === 0 && (
        <p className="px-5 py-4 text-sm text-muted">
          {failedOnly ? 'No failed syncs. 🎉' : 'No syncs yet.'}
        </p>
      )}
      {runs.data && runs.data.data.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th className={th}>Connection</th>
              <th className={th}>Started</th>
              <th className={th}>Result</th>
              <th className={th}>Items</th>
              <th className={`${th} text-right`}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.data.data.map((r) => (
              <tr key={r.id} className={cn(r.status === 'failed' && 'bg-danger-soft/40')}>
                <td className={td}>
                  <p className="font-medium">{r.connectionName}</p>
                  <p className="text-xs text-muted">
                    {providerLabel[r.provider ?? ''] ?? r.provider} · {r.kind}
                  </p>
                </td>
                <td className={`${td} text-muted`}>{new Date(r.startedAt).toLocaleString()}</td>
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
                  {r.error && (
                    <p className="mt-1 max-w-sm text-xs break-words text-danger">{r.error}</p>
                  )}
                </td>
                <td className={`${td} text-muted`}>
                  {r.itemsSeen} seen · {r.itemsUpserted} indexed · {r.chunksEmbedded} embedded
                </td>
                <td className={`${td} text-right text-muted tabular-nums`}>
                  {r.finishedAt
                    ? `${((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000).toFixed(1)} s`
                    : '…'}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AuditLog() {
  const { workspace } = useWorkspace();
  const [action, setAction] = useState('');
  const log = useInfiniteQuery({
    queryKey: ['audit', workspace.id, action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<{ data: AuditEntry[]; nextCursor: string | null }>(
        `/v1/workspaces/${workspace.id}/audit-log?${new URLSearchParams({
          limit: '25',
          ...(pageParam && { before: pageParam }),
          ...(action && { action }),
        })}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = log.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Card>
      <CardHeader
        title="Audit log"
        description="Security-relevant changes in this workspace. Document content and search text are never logged."
        actions={
          <Select
            aria-label="Filter activity"
            className="h-8 w-40"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            {filters.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        }
      />
      {log.isLoading && (
        <div className="px-5">
          <Spinner />
        </div>
      )}
      {log.isError && (
        <div className="p-5">
          <ErrorNote>Couldn't load the audit log.</ErrorNote>
        </div>
      )}
      {log.data && rows.length === 0 && (
        <p className="px-5 py-4 text-sm text-muted">Nothing recorded yet.</p>
      )}
      {rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Who</th>
              <th className={th}>What</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap text-muted`}>
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className={td}>
                  <p>{e.actorName ?? 'Deleted user'}</p>
                  {e.actorEmail && <p className="text-xs text-muted">{e.actorEmail}</p>}
                </td>
                <td className={td}>
                  {actionLabels[e.action] ?? e.action}
                  <code className="ml-2 text-[11px] text-muted">{e.action}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {log.hasNextPage && (
        <div className="border-t border-line p-3 text-center">
          <Button
            size="sm"
            loading={log.isFetchingNextPage}
            onClick={() => void log.fetchNextPage()}
          >
            Load older
          </Button>
        </div>
      )}
    </Card>
  );
}

export function AdminPage() {
  return (
    <AdminOnly>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Admin"
          description="Sync health and the audit trail for this workspace."
        />
        <SyncRuns />
        <AuditLog />
      </div>
    </AdminOnly>
  );
}
