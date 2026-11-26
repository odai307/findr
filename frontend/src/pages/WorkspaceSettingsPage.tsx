import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, isAdmin } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import { Card, CardHeader, PageHeader } from '../ui/Surface';
import { useToast } from '../ui/Toast';

export function WorkspaceSettingsPage() {
  const { workspace, me, setWorkspaceId } = useWorkspace();
  return <WorkspaceSettings key={workspace.id} {...{ workspace, me, setWorkspaceId }} />;
}

function WorkspaceSettings({ workspace, me, setWorkspaceId }: ReturnType<typeof useWorkspace>) {
  const [name, setName] = useState(workspace.name);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const admin = isAdmin(workspace.role);
  const owner = workspace.role === 'owner';
  const onError = (err: unknown) =>
    toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');

  const rename = useMutation({
    mutationFn: (n: string) =>
      api(`/v1/workspaces/${workspace.id}`, { method: 'PATCH', body: JSON.stringify({ name: n }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('Workspace renamed');
    },
    onError,
  });
  const leave = useMutation({
    mutationFn: () =>
      api(`/v1/workspaces/${workspace.id}/members/${me.user.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      const other = me.workspaces.find((w) => w.id !== workspace.id);
      if (other) setWorkspaceId(other.id);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast(`You left ${workspace.name}`);
      navigate('/');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api(`/v1/workspaces/${workspace.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      const other = me.workspaces.find((w) => w.id !== workspace.id);
      if (other) setWorkspaceId(other.id);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast(`Deleted ${workspace.name}`);
      navigate('/');
    },
    onError,
  });

  const onRename = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== workspace.name) rename.mutate(name.trim());
  };
  const onlyWorkspace = me.workspaces.length <= 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workspace settings"
        description={`You are ${workspace.role === 'admin' ? 'an' : 'the'} ${workspace.role} of this workspace.`}
      />

      <Card>
        <CardHeader title="General" />
        <form onSubmit={onRename} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Workspace name"
              hint={admin ? undefined : 'Only owners and admins can rename the workspace.'}
            >
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  disabled={!admin}
                />
              )}
            </Field>
          </div>
          {admin && (
            <Button
              type="submit"
              variant="primary"
              loading={rename.isPending}
              disabled={!name.trim() || name.trim() === workspace.name}
            >
              Save
            </Button>
          )}
        </form>
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          Workspace ID <code>{workspace.id}</code> · created{' '}
          {new Date(workspace.createdAt).toLocaleDateString()}
        </div>
      </Card>

      <Card className="border-danger/40">
        <CardHeader title="Danger zone" />
        <div className="flex flex-col divide-y divide-line">
          {!owner && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-medium">Leave workspace</p>
                <p className="text-sm text-muted">
                  You'll lose access to its connections and search.
                </p>
              </div>
              <Button
                variant="danger"
                loading={leave.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Leave ${workspace.name}?`,
                      confirmLabel: 'Leave',
                      danger: true,
                    })
                  )
                    leave.mutate();
                }}
              >
                Leave
              </Button>
            </div>
          )}
          {owner && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-medium">Delete workspace</p>
                <p className="text-sm text-muted">
                  {onlyWorkspace
                    ? "This is your only workspace, so it can't be deleted."
                    : 'Deletes its connections, indexed data, conversations and API keys for everyone. This cannot be undone.'}
                </p>
              </div>
              <Button
                variant="danger"
                disabled={onlyWorkspace}
                loading={remove.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${workspace.name}?`,
                    description:
                      'Everything in this workspace is deleted for all members. This cannot be undone.',
                    confirmLabel: 'Delete workspace',
                    danger: true,
                  });
                  if (ok) remove.mutate();
                }}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
