/**
 * Fetch wrapper for the Findr API.
 *
 * - The access token lives only in this module's memory (never localStorage), so an XSS bug
 *   can't read a long-lived credential from storage.
 * - The refresh token is an httpOnly cookie the browser sends to /v1/auth/* automatically.
 * - On a 401, the wrapper refreshes once and retries. Parallel requests share one refresh.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export function onAuthChange(fn: (signedIn: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((fn) => fn(token !== null));
}

async function parseError(res: Response): Promise<ApiError> {
  const json = await res.json().catch(() => null);
  const body: ApiErrorBody = json?.error ?? { code: 'HTTP_' + res.status, message: res.statusText };
  return new ApiError(res.status, body);
}

/** Uses the refresh cookie to get a new access token. Returns false if signed out. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const data = (await res.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Low-level authorized request: adds the access token and, on a 401, refreshes once and retries.
 * Returns the raw Response (used directly for streaming answers). Throws ApiError on failure.
 */
export async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && retry && !path.startsWith('/v1/auth/')) {
    if (await refreshSession()) return authorizedFetch(path, init, false);
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authorizedFetch(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function devLogin(email: string, name?: string) {
  const data = await api<{ accessToken: string }>('/v1/auth/dev-login', {
    method: 'POST',
    body: JSON.stringify({ email, name: name || undefined }),
  });
  setAccessToken(data.accessToken);
}

export async function logout() {
  await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
  setAccessToken(null);
}

export const googleLoginUrl = `${API_BASE}/v1/auth/google`;

// --- Response types (mirror the backend's Zod schemas) ---

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    emailVerified: boolean;
  };
  workspaces: Workspace[];
}

export interface Providers {
  google: boolean;
  devLogin: boolean;
}

export interface SyncRun {
  kind: 'full' | 'incremental';
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  itemsSeen: number;
  itemsUpserted: number;
  itemsUnchanged: number;
  itemsDeleted: number;
  chunksEmbedded: number;
  chunksReused: number;
  error: string | null;
}

export interface Connection {
  id: string;
  provider: string;
  displayName: string;
  visibility: 'personal' | 'workspace';
  status: 'active' | 'syncing' | 'paused' | 'error' | 'revoked';
  isOwner: boolean;
  documentCount: number;
  chunkCount: number;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  errorMessage: string | null;
  lastRun: SyncRun | null;
}

export type SearchMode = 'hybrid' | 'keyword' | 'semantic';

export interface SearchHit {
  documentId: string;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author: string | null;
  container: string | null;
  updatedAt: string | null;
  snippets: string[];
  matchedTerms: string[];
  score: number;
}

export interface SearchFilters {
  sources?: string[];
  types?: string[];
  from?: string;
  in?: string;
  /** YYYY-MM-DD when sent; ISO date-time when returned. */
  after?: string;
  before?: string;
}

export interface SearchResponse {
  data: SearchHit[];
  degraded: boolean;
  parsed: { text: string; filters: SearchFilters };
  tookMs: number;
}

export interface Citation {
  n: number;
  documentId: string;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author: string | null;
  updatedAt: string | null;
  snippet: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'error' | 'aborted';
  rewrittenQuery: string | null;
  citations: Citation[];
  createdAt: string;
}

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
}

export type Role = 'owner' | 'admin' | 'member';

export interface Member {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface InvitePreview {
  workspaceName: string;
  role: Role;
  email: string;
  invitedBy: string | null;
  expiresAt: string;
}

export type ApiScope = 'search' | 'ask';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdByName: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Usage {
  days: number;
  daily: { day: string; searches: number; asks: number; tokens: number }[];
  totals: { searches: number; asks: number; tokens: number };
  models: {
    model: string;
    kind: string;
    calls: number;
    promptTokens: number;
    completionTokens: number;
  }[];
  feedback: { up: number; down: number };
}

export interface SyncRunRow extends SyncRun {
  id: string;
  connectionId: string;
  connectionName?: string;
  provider?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
}

export const isAdmin = (role: Role) => role === 'owner' || role === 'admin';

export const providerLabel: Record<string, string> = {
  demo: 'Demo',
  gmail: 'Gmail',
  gdrive: 'Google Drive',
  slack: 'Slack',
  notion: 'Notion',
  github: 'GitHub',
};
