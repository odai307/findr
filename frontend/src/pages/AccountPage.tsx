import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, logout } from '../lib/api';
import { cn } from '../lib/cn';
import { useTheme, type ThemeSetting } from '../lib/theme';
import { useWorkspace } from '../lib/workspace';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import { Avatar, Badge, Card, CardHeader, PageHeader } from '../ui/Surface';
import { useToast } from '../ui/Toast';

export function AccountPage() {
  const { me } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(me.user.name);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();

  const rename = useMutation({
    mutationFn: (n: string) =>
      api('/v1/me', { method: 'PATCH', body: JSON.stringify({ name: n }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('Name updated');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });
  const logoutAll = useMutation({
    mutationFn: () => api('/v1/auth/logout-all', { method: 'POST' }),
    onSettled: () => void logout().then(() => queryClient.clear()),
  });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== me.user.name) rename.mutate(name.trim());
  };

  const themes: { value: ThemeSetting; label: string; icon: ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Account" />

      <Card>
        <CardHeader title="Profile" />
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-center gap-3">
            <Avatar name={me.user.name} src={me.user.avatarUrl} size={44} />
            <div>
              <p className="font-medium">{me.user.email}</p>
              <p className="text-xs text-muted">
                {me.user.emailVerified ? (
                  <Badge tone="success">Verified by Google</Badge>
                ) : (
                  <Badge>Not verified (dev sign-in)</Badge>
                )}
              </p>
            </div>
          </div>
          <form onSubmit={onSave} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Display name">
                {(p) => (
                  <Input
                    {...p}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                  />
                )}
              </Field>
            </div>
            <Button
              type="submit"
              variant="primary"
              loading={rename.isPending}
              disabled={!name.trim() || name.trim() === me.user.name}
            >
              Save
            </Button>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader title="Appearance" description="Saved in this browser." />
        <div role="radiogroup" aria-label="Theme" className="grid gap-3 p-5 sm:grid-cols-3">
          {themes.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              onClick={() => setTheme(t.value)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm',
                theme === t.value
                  ? 'border-accent bg-accent-soft font-medium text-accent'
                  : 'border-line hover:bg-surface-2',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Sessions" />
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-sm font-medium">Sign out of all devices</p>
            <p className="text-sm text-muted">
              Ends every session, including this one. Use it if you lost a device.
            </p>
          </div>
          <Button
            variant="danger"
            loading={logoutAll.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Sign out of all devices?',
                confirmLabel: 'Sign out everywhere',
                danger: true,
              });
              if (ok) logoutAll.mutate();
            }}
          >
            Sign out everywhere
          </Button>
        </div>
      </Card>
    </div>
  );
}
