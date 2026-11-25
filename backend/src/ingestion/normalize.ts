import type { SourceDocument } from '../connectors/types.js';
import { sha256 } from '../shared/crypto.js';

const providerLabels: Record<string, string> = {
  demo: 'Demo',
  gmail: 'Gmail',
  gdrive: 'Drive',
  slack: 'Slack',
  notion: 'Notion',
  github: 'GitHub',
};

const entities: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Extracts readable text from HTML for indexing. This output is only ever indexed and shown as
 * plain text, never rendered as HTML, so a simple tag stripper is enough here. Real email HTML
 * gets a proper converter with the Gmail connector.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => entities[m] ?? m);
}

/** Converts a document's content to clean Markdown-ish text. */
export function normalizeText(
  content: Extract<SourceDocument['content'], { kind: 'text' }>,
): string {
  const raw = content.format === 'html' ? htmlToText(content.text) : content.text;
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * One line prepended to every chunk (for both embedding and keyword search) so each chunk makes
 * sense on its own, e.g. "[Demo · email] Delivery timeline for Project Alpha | From: Ama Mensah | 2026-02-02".
 * Uses the creation date, not the update date, so a metadata-only edit doesn't change it.
 */
export function contextHeader(provider: string, doc: SourceDocument): string {
  const parts = [
    `[${providerLabels[provider] ?? provider} · ${doc.type.replace('_', ' ')}] ${doc.title ?? 'Untitled'}`,
  ];
  if (doc.author?.name) parts.push(`From: ${doc.author.name}`);
  if (doc.container) parts.push(`In: ${doc.container}`);
  parts.push(doc.createdAt.toISOString().slice(0, 10));
  return parts.join(' | ');
}

/** Hash of everything that gets embedded. Fix C2: the ACL is deliberately not part of it. */
export function documentTextHash(header: string, text: string): string {
  return sha256(`${header}\n\n${text}`);
}

/** Sorted, de-duplicated principals, so two equal access lists compare equal. */
export function normalizeAcl(acl: string[]): string[] {
  return [...new Set(acl.map((p) => p.trim()).filter(Boolean))].sort();
}
