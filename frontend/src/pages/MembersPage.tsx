import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, Trash2, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError, isAdmin, type Invite, type Member, type Role } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Button } from '../ui/Button';
import { CopyField } from '../ui/CopyButton';
import { Dialog, useConfirm } from '../ui/Dialog';
import { Field, Input, Select } from '../ui/Field';
import {
  Avatar,
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
import { useToast } from '../ui/Toast';

const roleHelp: Record<Role, string> = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Members, invites, connections, API keys, usage and admin',
  member: 'Search, ask, and their own connections',
};

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [link, setLink] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ invite: Invite; inviteUrl: string }>(`/v1/workspaces/${workspace.id}/invites`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: (res) => {
      setLink(res.inviteUrl);
      void queryClient.invalidateQueries({ queryKey: ['invites', workspace.id] });
    },
  });
  const close = () => {
    setEmail('');
    setRole('member');
    setLink(null);
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
      title={link ? 'Share this invite link' : 'Invite someone'}
      description={
        link
          ? `Send it to ${email} however you like. It works once, only for that address, and expires in 7 days.`
          : 'Findr creates a one-time link for you to share. It does not send email.'
      }
    >
      {link ? (
        <div className="flex flex-col gap-4 pb-5">
          <CopyField value={link} toast="Invite link copied" />
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 pb-5">
          <Field label="Email">
            {(p) => (
              <Input
                {...p}
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
              />
            )}
          </Field>
          <Field label="Role" hint={roleHelp[role]}>
            {(p) => (
              <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {workspace.role === 'owner' && <option value="owner">Owner</option>}
              </Select>
            )}
          </Field>
          {create.isError && (
            <ErrorNote>
              {create.error instanceof ApiError
                ? create.error.message
                : 'Could not create the invite.'}
            </ErrorNote>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create invite link
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function MembersPage() {
  const { workspace, me } = useWorkspace();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const admin = isAdmin(workspace.role);
  const base = `/v1/workspaces/${workspace.id}`;
  const onError = (err: unknown) =>
    toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');

  const members = useQuery({
    queryKey: ['members', workspace.id],
    queryFn: () => api<{ data: Member[] }>(`${base}/members`),
  });
  const invites = useQuery({
    queryKey: ['invites', workspace.id],
    enabled: admin,
    queryFn: () => api<{ data: Invite[] }>(`${base}/invites`),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['members', workspace.id] });

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) =>
      api(`${base}/members/${v.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: v.role }),
      }),
    onSuccess: () => toast('Role updated'),
    onError,
    onSettled: refresh,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`${base}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => toast('Member removed'),
    onError,
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`${base}/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast('Invite revoked'),
    onError,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['invites', workspace.id] }),
  });

  /** Whether the current user may change this member (mirrors the server's rules). */
  const canManage = (m: Member) =>
    admin && m.userId !== me.user.id && (m.role !== 'owner' || workspace.role === 'owner');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description="People in this workspace and what they can do."
        actions={
          admin && (
            <Button
              variant="primary"
              icon={<MailPlus className="size-4" />}
              onClick={() => setInviting(true)}
            >
              Invite
            </Button>
          )
        }
      />

      <Card>
        {members.isLoading && (
          <div className="px-5">
            <Spinner />
          </div>
        )}
        {members.data && (
          <Table>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Role</th>
                <th className={th}>Joined</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.data.data.map((m) => (
                <tr key={m.userId}>
                  <td className={td}>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} src={m.avatarUrl} size={32} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.name} {m.userId === me.user.id && <Badge>You</Badge>}
                        </p>
                        <p className="truncate text-xs text-muted">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className={td}>
                    {canManage(m) ? (
                      <Select
                        aria-label={`Role for ${m.name}`}
                        className="h-8 w-28"
                        value={m.role}
                        onChange={(e) =>
                          changeRole.mutate({ userId: m.userId, role: e.target.value as Role })
                        }
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        {workspace.role === 'owner' && <option value="owner">Owner</option>}
                      </Select>
                    ) : (
                      <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{m.role}</Badge>
                    )}
                  </td>
                  <td className={`${td} text-muted`}>
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </td>
                  <td className={`${td} text-right`}>
                    {canManage(m) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${m.name}`}
                        icon={<UserMinus className="size-3.5" />}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove ${m.name}?`,
                            description:
                              'They lose access immediately. Their personal connections in this workspace are deleted.',
                            confirmLabel: 'Remove',
                            danger: true,
                          });
                          if (ok) removeMember.mutate(m.userId);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {admin && (
        <Card>
          <CardHeader
            title="Pending invites"
            description="Links that haven't been used yet. They expire after 7 days."
          />
          {invites.data?.data.length === 0 && (
            <p className="px-5 py-4 text-sm text-muted">No pending invites.</p>
          )}
          {invites.data && invites.data.data.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Email</th>
                  <th className={th}>Role</th>
                  <th className={th}>Expires</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.data.data.map((i) => (
                  <tr key={i.id}>
                    <td className={td}>{i.email}</td>
                    <td className={td}>
                      <Badge>{i.role}</Badge>
                    </td>
                    <td className={`${td} text-muted`}>
                      {new Date(i.expiresAt).toLocaleDateString()}
                    </td>
                    <td className={`${td} text-right`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="size-3.5" />}
                        onClick={() => revoke.mutate(i.id)}
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
      )}

      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
    </div>
  );
}
