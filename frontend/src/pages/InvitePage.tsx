import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, logout, type InvitePreview, type Workspace } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Button, buttonClass } from '../ui/Button';
import { Badge, Card, ErrorNote, Spinner } from '../ui/Surface';
import { useToast } from '../ui/Toast';

/** /invite/:token — shows who invited you to what, and joins the workspace on accept. */
export function InvitePage() {
  const { token = '' } = useParams();
  const { me, setWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InvitePreview>(`/v1/invites/${encodeURIComponent(token)}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      api<Workspace>(`/v1/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    onSuccess: async (ws) => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      setWorkspaceId(ws.id);
      toast(`You joined ${ws.name}`);
      navigate('/');
    },
  });

  const wrongAccount = preview.data && preview.data.email !== me.user.email;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md p-6">
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Users className="size-5" aria-hidden />
        </div>
        {preview.isLoading && <Spinner label="Checking your invitation…" />}
        {preview.isError && (
          <>
            <h1 className="text-lg font-semibold">This invite link doesn't work</h1>
            <p className="mt-1 text-sm text-muted">
              It may have expired, been revoked, or already been used. Ask for a new link.
            </p>
            <Link to="/" className={buttonClass('secondary', 'md', 'mt-6')}>
              Go to Findr
            </Link>
          </>
        )}
        {preview.data && (
          <>
            <h1 className="text-lg font-semibold">Join {preview.data.workspaceName}</h1>
            <p className="mt-1 text-sm text-muted">
              {preview.data.invitedBy ?? 'Someone'} invited{' '}
              <strong className="text-fg">{preview.data.email}</strong> as{' '}
              <Badge tone="accent">{preview.data.role}</Badge>
            </p>
            <p className="mt-1 text-xs text-muted">
              Expires {new Date(preview.data.expiresAt).toLocaleDateString()}
            </p>

            {wrongAccount ? (
              <div className="mt-6 flex flex-col gap-3">
                <ErrorNote>
                  You're signed in as {me.user.email}. Sign in as {preview.data.email} to accept.
                </ErrorNote>
                <Button onClick={() => void logout().then(() => queryClient.clear())}>
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="mt-6 flex flex-col gap-3">
                {accept.isError && (
                  <ErrorNote>
                    {accept.error instanceof ApiError
                      ? accept.error.message
                      : 'Could not join. Try again.'}
                  </ErrorNote>
                )}
                <Button
                  variant="primary"
                  loading={accept.isPending}
                  onClick={() => accept.mutate()}
                >
                  Accept and join
                </Button>
                <Link to="/" className={buttonClass('ghost')}>
                  Not now
                </Link>
              </div>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
