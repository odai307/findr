import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError, devLogin, googleLoginUrl, type Providers } from '../lib/api';

export function LoginPage() {
  const [params] = useSearchParams();
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
      setError(err instanceof ApiError ? err.message : 'Could not reach the API. Is it running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Findr</h1>
        <p className="mt-1 text-sm text-zinc-500">Search all your work apps in one place.</p>
      </div>

      {providers.isError && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Can't reach the API. Start it with <code>pnpm dev</code>.
        </p>
      )}

      {providers.data?.google && (
        <a
          href={googleLoginUrl}
          className="rounded-md bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Continue with Google
        </a>
      )}

      {providers.data?.devLogin && (
        <form
          onSubmit={onDevLogin}
          className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
        >
          <label
            htmlFor="email"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Dev login (local only)
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

      {providers.data && !providers.data.google && !providers.data.devLogin && (
        <p className="text-sm text-zinc-500">No sign-in method is configured on the API.</p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}
