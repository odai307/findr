/**
 * Pulls filters out of what the user typed, e.g.
 *   `budget source:gmail type:email from:esi after:2026-01-01`
 * → text "budget" + filters { sources: ['gmail'], types: ['email'], from: 'esi', after: 2026-01-01 }.
 * Values with spaces can be quoted: `in:"Projects/Alpha"`. Unknown `key:value` pairs stay in
 * the text (so searching "INC-2041:" or a URL still works).
 */

export interface SearchFilters {
  sources?: string[];
  types?: string[];
  /** Matches the author's name or email (case-insensitive, partial). */
  from?: string;
  /** Matches the container: channel, folder or thread name (case-insensitive, partial). */
  in?: string;
  after?: Date;
  before?: Date;
}

export interface ParsedQuery {
  text: string;
  filters: SearchFilters;
}

const sourceAliases: Record<string, string> = { drive: 'gdrive', google_drive: 'gdrive' };
const typeAliases: Record<string, string> = {
  doc: 'page',
  document: 'page',
  message: 'message_thread',
  thread: 'message_thread',
  slack: 'message_thread',
  pr: 'pull_request',
};

/** Accepts YYYY-MM-DD or YYYY-MM. Returns undefined for anything else. */
export function parseDate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const FILTER = /(?:^|\s)(source|type|from|in|after|before):("([^"]*)"|\S+)/gi;

export function parseQuery(raw: string): ParsedQuery {
  const filters: SearchFilters = {};
  const text = raw.replace(FILTER, (whole, key: string, value: string, quoted?: string) => {
    const v = (quoted ?? value).trim();
    if (!v) return whole;
    switch (key.toLowerCase()) {
      case 'source':
        (filters.sources ??= []).push(sourceAliases[v.toLowerCase()] ?? v.toLowerCase());
        return ' ';
      case 'type':
        (filters.types ??= []).push(typeAliases[v.toLowerCase()] ?? v.toLowerCase());
        return ' ';
      case 'from':
        filters.from = v;
        return ' ';
      case 'in':
        filters.in = v.replace(/^#/, '');
        return ' ';
      case 'after':
      case 'before': {
        const date = parseDate(v);
        if (!date) return whole;
        filters[key.toLowerCase() as 'after' | 'before'] = date;
        return ' ';
      }
      default:
        return whole;
    }
  });
  return { text: text.replace(/\s+/g, ' ').trim(), filters };
}

/** Combines filters typed in the query with ones sent as API fields (API fields win). */
export function mergeFilters(typed: SearchFilters, given: SearchFilters = {}): SearchFilters {
  const merged: SearchFilters = { ...typed };
  for (const [k, v] of Object.entries(given) as [keyof SearchFilters, unknown][]) {
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) {
      (merged as Record<string, unknown>)[k] = v;
    }
  }
  return merged;
}
