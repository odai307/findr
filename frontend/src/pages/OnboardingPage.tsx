import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Database, Loader2, MessageSquare, Pencil } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError, isAdmin, type Connection } from '../lib/api';
import { cn } from '../lib/cn';
import { markOnboarded } from '../lib/onboarding';
import { useWorkspace } from '../lib/workspace';
import { Button, buttonClass } from '../ui/Button';
import { Input } from '../ui/Field';
import { Card, ErrorNote } from '../ui/Surface';

function Step({
  n,
  title,
  done,
  active,
  icon,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className={cn('flex gap-4', !active && !done && 'opacity-60')}>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm',
          done
            ? 'border-success bg-success-soft text-success'
            : active
              ? 'border-accent text-accent'
              : 'border-line text-muted',
        )}
        aria-hidden
      >
        {done ? <Check className="size-4" /> : icon}
      </span>
      <div className="min-w-0 flex-1 pb-6">
        <p className="text-sm font-medium">
          <span className="sr-only">Step {n}: </span>
          {title}
        </p>
        {active && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}

/** First run: name the workspace → add the demo data → watch it sync → ask a first question. */
export function OnboardingPage() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(workspace.name);
  const [named, setNamed] = useState(false);
  const base = `/v1/workspaces/${workspace.id}/connections`;
  const canRename = isAdmin(workspace.role);

  const connections = useQuery({
    queryKey: ['connections', workspace.id],
    queryFn: () => api<{ data: Connection[] }>(base),
    refetchInterval: (q) =>
      q.state.data?.data.some(
        (c) => c.status === 'syncing' || !c.lastRun || c.lastRun.status === 'running',
      )
        ? 2000
        : false,
  });
  const rename = useMutation({
    mutationFn: (n: string) =>
      api(`/v1/workspaces/${workspace.id}`, { method: 'PATCH', body: JSON.stringify({ name: n }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      setNamed(true);
    },
  });
  const addDemo = useMutation({
    mutationFn: () => api<Connection>(`${base}/demo`, { method: 'POST' }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['connections', workspace.id] }),
  });

  const demo = connections.data?.data.find((c) => c.provider === 'demo');
  const synced = demo?.lastRun?.status === 'succeeded' && demo.status === 'active';
  const syncing = Boolean(demo) && !synced;
  const step1Done = named || !canRename;
  const step2Done = Boolean(demo);

  const finish = (to: string) => {
    markOnboarded(workspace.id);
    navigate(to);
  };

  const onRename = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === workspace.name) setNamed(true);
    else if (name.trim()) rename.mutate(name.trim());
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Findr</h1>
        <p className="mt-1 text-sm text-muted">
          Three quick steps. Findr comes with demo data from a fictional company, Tamarind Labs, so
          you can try it without connecting your own accounts.
        </p>

        <Card className="mt-6 p-6">
          <ol>
            <Step
              n={1}
              title="Name your workspace"
              done={step1Done}
              active={!step1Done}
              icon={<Pencil className="size-4" />}
            >
              <form onSubmit={onRename} className="flex gap-2">
                <Input
                  aria-label="Workspace name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
                <Button type="submit" variant="primary" loading={rename.isPending}>
                  Continue
                </Button>
              </form>
            </Step>

            <Step
              n={2}
              title="Add the demo data"
              done={step2Done}
              active={step1Done && !step2Done}
              icon={<Database className="size-4" />}
            >
              <p className="mb-3 text-sm text-muted">
                82 emails, docs and Slack threads about projects, budgets, incidents and policies.
              </p>
              {addDemo.isError && (
                <div className="mb-3">
                  <ErrorNote>
                    {addDemo.error instanceof ApiError
                      ? addDemo.error.message
                      : 'Could not add the demo data.'}
                  </ErrorNote>
                </div>
              )}
              <Button
                variant="primary"
                loading={addDemo.isPending}
                onClick={() => addDemo.mutate()}
              >
                Add demo data
              </Button>
            </Step>

            <Step
              n={3}
              title={synced ? 'Ready to search' : 'Indexing'}
              done={synced}
              active={step2Done && !synced}
              icon={<MessageSquare className="size-4" />}
            >
              {syncing && (
                <p className="flex items-center gap-2 text-sm text-muted" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Reading and indexing documents
                  {demo?.documentCount ? ` (${demo.documentCount} so far)` : ''}…
                </p>
              )}
            </Step>
          </ol>

          {synced && (
            <div className="flex flex-col gap-3 border-t border-line pt-5">
              <p className="text-sm">
                Indexed <strong>{demo?.documentCount}</strong> documents. Try your first question:
              </p>
              <button
                type="button"
                onClick={() =>
                  finish(
                    `/?q=${encodeURIComponent('When will Harbor get the route optimizer, and did the date change?')}`,
                  )
                }
                className="rounded-md border border-line bg-surface-2 px-3 py-2 text-left text-sm hover:border-accent"
              >
                “When will Harbor get the route optimizer, and did the date change?”
              </button>
              <Button variant="primary" onClick={() => finish('/')}>
                Go to search
              </Button>
            </div>
          )}
        </Card>

        <div className="mt-4 text-center">
          <Link
            to="/"
            onClick={() => markOnboarded(workspace.id)}
            className={buttonClass('ghost', 'sm')}
          >
            Skip for now
          </Link>
        </div>
      </div>
    </main>
  );
}
