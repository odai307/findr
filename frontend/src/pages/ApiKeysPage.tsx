import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AdminOnly } from '../components/AdminOnly';
import { api, ApiError, type ApiKey, type ApiScope } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Button } from '../ui/Button';
import { CopyField } from '../ui/CopyButton';
import { Dialog, useConfirm } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
  Table,
  td,
  th,
} from '../ui/Surface';
import { useToast } from '../ui/Toast';

function CreateKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['search']);
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ key: string; apiKey: ApiKey }>(`/v1/workspaces/${workspace.id}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name, scopes }),
      }),
    onSuccess: (res) => {
      setCreated(res.key);
      void queryClient.invalidateQueries({ queryKey: ['api-keys', workspace.id] });
    },
  });
  const toggle = (s: ApiScope) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const close = () => {
    setName('');
    setScopes(['search']);
    setCreated(null);
    create.reset();
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={created ? 'Copy your API key now' : 'Create an API key'}
      description={
        created
          ? "This is the only time it's shown. Store it somewhere safe, like a password manager or your CI's secrets."
          : 'Keys only see content shared with the whole workspace, never anyone’s personal items.'
      }
    >
      {created ? (
        <div className="flex flex-col gap-4 pb-5">
          <CopyField value={created} toast="API key copied" />
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              I've saved it
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 pb-5">
          <Field label="Name" hint="So you can tell keys apart, e.g. “Slack bot” or “CI”.">
            {(p) => (
              <Input
                {...p}
                required
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Permissions</legend>
            {(
              [
                ['search', 'Search', 'POST /search'],
                ['ask', 'Ask', 'POST /ask (AI answers, counts toward daily limits)'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--accent)]"
                  checked={scopes.includes(value)}
                  onChange={() => toggle(value)}
                />
                <span>
                  {label}
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {create.isError && (
            <ErrorNote>
              {create.error instanceof ApiError
                ? create.error.message
                : 'Could not create the key.'}
            </ErrorNote>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim() || scopes.length === 0}
            >
              Create key
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function ApiKeysPage() {
  return (
    <AdminOnly>
      <ApiKeys />
    </AdminOnly>
  );
}

function ApiKeys() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const keys = useQuery({
    queryKey: ['api-keys', workspace.id],
    queryFn: () => api<{ data: ApiKey[] }>(`/v1/workspaces/${workspace.id}/api-keys`),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/workspaces/${workspace.id}/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast('Key revoked'),
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not revoke the key.', 'error'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['api-keys', workspace.id] }),
  });

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const curl = `curl -X POST ${origin}/v1/workspaces/${workspace.id}/search \\
  -H "X-API-Key: fdr_…" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "Project Alpha budget", "limit": 5}'`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="API keys"
        description="Let other tools search and ask Findr on behalf of this workspace."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => setCreating(true)}
          >
            Create key
          </Button>
        }
      />

      <Card>
        {keys.isLoading && (
          <div className="px-5">
            <Spinner />
          </div>
        )}
        {keys.data?.data.length === 0 && (
          <div className="p-5">
            <EmptyState icon={<KeyRound className="size-7" />} title="No API keys yet">
              Create one to call the search or ask API from scripts, bots or CI.
            </EmptyState>
          </div>
        )}
        {keys.data && keys.data.data.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Key</th>
                <th className={th}>Permissions</th>
                <th className={th}>Last used</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.data.data.map((k) => (
                <tr key={k.id}>
                  <td className={td}>
                    <p className="font-medium">{k.name}</p>
                    <p className="text-xs text-muted">
                      by {k.createdByName ?? 'unknown'} ·{' '}
                      {new Date(k.createdAt).toLocaleDateString()}
                    </p>
                  </td>
                  <td className={td}>
                    <code>fdr_{k.prefix}_…</code>
                  </td>
                  <td className={td}>
                    <div className="flex gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} tone="accent">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className={`${td} text-muted`}>
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                  </td>
                  <td className={`${td} text-right`}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" />}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Revoke “${k.name}”?`,
                          description: 'Anything using this key stops working immediately.',
                          confirmLabel: 'Revoke',
                          danger: true,
                        });
                        if (ok) revoke.mutate(k.id);
                      }}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Example"
          description="Search with a key. Results include only content shared with the whole workspace."
        />
        <pre className="overflow-x-auto p-5 text-xs leading-relaxed">
          <code className="bg-transparent p-0">{curl}</code>
        </pre>
      </Card>

      <CreateKeyDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
