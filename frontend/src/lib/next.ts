/**
 * Remembers where a signed-out user was going (e.g. an invite link), so they land there after
 * signing in. Google sign-in leaves the site, so the target is kept in sessionStorage.
 */
const KEY = 'findr.next';

/** Only same-site paths, never full URLs (prevents open redirects). */
export function safeNext(value: string | null | undefined): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

export function rememberNext(path: string | null) {
  try {
    if (path) sessionStorage.setItem(KEY, path);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the user just lands on the home page.
  }
}

export function peekNext(): string | null {
  try {
    return safeNext(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}
