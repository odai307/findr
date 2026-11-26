import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { requireAdmin } from './members.js';

const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];

/**
 * Workspace usage for the last `days` days (owners and admins): searches, questions and AI tokens
 * per day (days with no activity included as zeros), totals per model, and answer feedback.
 * On the free tier there is no cost, so tokens are shown instead.
 */
export async function getUsage(db: Db, workspaceId: string, userId: string, days: number) {
  await requireAdmin(db, workspaceId, userId);

  const daily = rowsOf<{ day: string; searches: string; asks: string; tokens: string }>(
    await db.execute(sql`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
             COUNT(e.id) FILTER (WHERE e.kind = 'search') AS searches,
             COUNT(e.id) FILTER (WHERE e.kind = 'ask') AS asks,
             COALESCE(SUM(e.prompt_tokens + e.completion_tokens) FILTER (WHERE e.kind <> 'search'), 0) AS tokens
      FROM generate_series(
             date_trunc('day', now()) - make_interval(days => ${days - 1}),
             date_trunc('day', now()),
             interval '1 day') AS d
      LEFT JOIN usage_events e
        ON e.workspace_id = ${workspaceId}
       AND e.created_at >= d AND e.created_at < d + interval '1 day'
      GROUP BY d
      ORDER BY d`),
  );

  const models = rowsOf<{
    model: string;
    kind: string;
    calls: string;
    prompt: string;
    completion: string;
  }>(
    await db.execute(sql`
      SELECT model, kind, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens), 0) AS prompt, COALESCE(SUM(completion_tokens), 0) AS completion
      FROM usage_events
      WHERE workspace_id = ${workspaceId}
        AND created_at >= date_trunc('day', now()) - make_interval(days => ${days - 1})
        AND kind <> 'search'
      GROUP BY model, kind
      ORDER BY COUNT(*) DESC`),
  );

  const [fb] = rowsOf<{ up: string; down: string }>(
    await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE f.rating > 0) AS up, COUNT(*) FILTER (WHERE f.rating < 0) AS down
      FROM feedback f
      JOIN messages m ON m.id = f.message_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${workspaceId}
        AND f.created_at >= date_trunc('day', now()) - make_interval(days => ${days - 1})`),
  );

  const perDay = daily.map((d) => ({
    day: d.day,
    searches: Number(d.searches),
    asks: Number(d.asks),
    tokens: Number(d.tokens),
  }));
  return {
    days,
    daily: perDay,
    totals: {
      searches: perDay.reduce((s, d) => s + d.searches, 0),
      asks: perDay.reduce((s, d) => s + d.asks, 0),
      tokens: perDay.reduce((s, d) => s + d.tokens, 0),
    },
    models: models.map((m) => ({
      model: m.model,
      kind: m.kind,
      calls: Number(m.calls),
      promptTokens: Number(m.prompt),
      completionTokens: Number(m.completion),
    })),
    feedback: { up: Number(fb?.up ?? 0), down: Number(fb?.down ?? 0) },
  };
}
