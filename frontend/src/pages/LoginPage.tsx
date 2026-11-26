import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError, devLogin, googleLoginUrl, type Providers } from '../lib/api';
import { rememberNext, safeNext } from '../lib/next';
import { Button, buttonClass } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Card, ErrorNote, Spinner } from '../ui/Surface';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"
      />
    </svg>
  );
}

const points = [
  {
    icon: <Search className="size-4" />,
    text: 'One search box across Gmail, Drive, Slack and more',
  },
  {
    icon: <Sparkles className="size-4" />,
    text: 'Answers written from your own documents, with sources',
  },
  {
    icon: <ShieldCheck className="size-4" />,
    text: 'You only ever see what you can see in the original app',
  },
];

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<Providers>('/v1/auth/providers'),
  });
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(
    params.get('error') ? 'Google sign-in failed. Please try again.' : null,
  );
  const [busy, setBusy] = useState(false);

  async function onDevLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await devLogin(email);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the server. Is it running?',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-accent p-10 text-accent-fg lg:flex">
        <span className="text-lg font-semibold">Findr</span>
        <div>
          <h2 className="max-w-md text-3xl leading-tight font-semibold">
            Find anything your team has written, in seconds.
          </h2>
          <ul className="mt-8 flex flex-col gap-4">
            {points.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-sm opacity-90">
                <span className="flex size-8 items-center justify-center rounded-md bg-white/15">
                  {p.icon}
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <span className="text-xs opacity-70">
          Portfolio project · demo data is a fictional company
        </span>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Findr</h1>
          <p className="mt-1 text-sm text-muted">
            {next?.startsWith('/invite/')
              ? 'Sign in to accept your invitation.'
              : 'Search all your work apps in one place.'}
          </p>

          <div className="mt-8 flex flex-col gap-4">
            {providers.isLoading && <Spinner />}
            {providers.isError && (
              <ErrorNote>
                Can't reach the server. Start it with <code>pnpm dev</code>.
              </ErrorNote>
            )}

            {providers.data?.google && (
              <a
                href={googleLoginUrl}
                onClick={() => rememberNext(next)}
                className={buttonClass('secondary', 'md', 'h-10 w-full')}
              >
                <GoogleIcon />
                Continue with Google
              </a>
            )}

            {providers.data?.google && providers.data.devLogin && (
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
            )}

            {providers.data?.devLogin && (
              <Card className="p-4">
                <form onSubmit={onDevLogin} className="flex flex-col gap-3">
                  <Field label="Email" hint="Development sign-in: any address works, no password.">
                    {(p) => (
                      <Input
                        {...p}
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    )}
                  </Field>
                  <Button type="submit" variant="primary" loading={busy}>
                    Sign in
                  </Button>
                </form>
              </Card>
            )}

            {providers.data && !providers.data.google && !providers.data.devLogin && (
              <ErrorNote>No sign-in method is configured on the server.</ErrorNote>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
        </div>
      </section>
    </main>
  );
}
