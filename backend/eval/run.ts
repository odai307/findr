/**
 * Search-quality evaluation (design §17.2).
 *
 *   pnpm --filter backend eval                 # real embeddings (GEMINI_API_KEY from backend/.env)
 *   pnpm --filter backend eval --fake          # fake local embedder, no key (what CI runs)
 *   pnpm --filter backend eval --fake --min-recall=0.8   # exit 1 if hybrid Recall@10 is lower
 *
 * Loads the demo dataset into a throwaway in-memory database, asks every golden question in
 * keyword, semantic and hybrid mode, and reports Recall@10, MRR and nDCG@10. Results are saved to
 * eval/results/ so changes can be compared over time.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { principalsFor } from '../src/auth/principals.js';
import { upsertDevUser } from '../src/auth/users.js';
import { createDemoConnection } from '../src/connections/service.js';
import { createDemoConnector } from '../src/connectors/demo/index.js';
import { openDatabase } from '../src/db/client.js';
import { documents } from '../src/db/schema.js';
import { createFakeEmbedder, type Embedder } from '../src/ingestion/embedder.js';
import { createEmbedder } from '../src/ingestion/setup.js';
import { runSync } from '../src/ingestion/sync.js';
import { hybridSearch, type SearchMode } from '../src/search/hybrid.js';
import { parseQuery } from '../src/search/query-parser.js';
import { loadConfig } from '../src/shared/config.js';
import { listWorkspacesForUser } from '../src/workspaces/service.js';
import { scoreRanking } from './metrics.js';

interface Question {
  id: string;
  kind: 'fact' | 'paraphrase' | 'filter' | 'restricted' | 'unanswerable';
  question: string;
  relevant: string[];
  forbidden?: string[];
  answer: string | null;
}

const K = 10;
const MODES: SearchMode[] = ['keyword', 'semantic', 'hybrid'];

const args = process.argv.slice(2);
const useFake = args.includes('--fake');
const minRecall = Number(args.find((a) => a.startsWith('--min-recall='))?.split('=')[1] ?? NaN);
/** --sweep also tries several keyword weights for hybrid fusion, reusing the same embeddings. */
const sweep = args.includes('--sweep');
const SWEEP_WEIGHTS = [1, 0.75, 0.5, 0.35, 0.25];

const here = fileURLToPath(new URL('.', import.meta.url));
const golden = JSON.parse(readFileSync(`${here}golden.json`, 'utf8')) as { questions: Question[] };
const log = pino({ level: 'warn' });

function embedderFor(): Embedder {
  if (useFake) return createFakeEmbedder();
  // Uses backend/.env, but always against a throwaway in-memory database.
  const config = loadConfig();
  if (!config.GEMINI_API_KEY && !config.OPENAI_API_KEY) {
    console.error('No embeddings key in backend/.env. Use --fake for the local fake embedder.');
    process.exit(1);
  }
  return createEmbedder(config, log);
}

async function main() {
  const embedder = embedderFor();
  console.log(`Embedder: ${embedder.model}`);

  // --- Index the demo dataset into a throwaway database. ---
  const database = await openDatabase('pglite:memory');
  await database.migrate();
  const user = await upsertDevUser(database.db, 'eval@example.com');
  const [ws] = await listWorkspacesForUser(database.db, user.id);
  const conn = await createDemoConnection(database.db, ws!.id, user.id);
  const started = Date.now();
  await runSync(
    { db: database.db, embedder, log, connectors: () => createDemoConnector() },
    conn.id,
    'full',
  );
  console.log(`Indexed demo data in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  const idMap = new Map(
    (await database.db.select({ id: documents.id, ext: documents.externalId }).from(documents)).map(
      (d) => [d.id, d.ext],
    ),
  );
  const principals = await principalsFor(database.db, user.id, ws!.id);

  // --- Ask every question in every mode. ---
  type Row = {
    id: string;
    kind: string;
    mode: SearchMode;
    recall: number;
    rr: number;
    ndcg: number;
  };
  const rows: Row[] = [];
  const violations: string[] = [];
  let degradedCount = 0;

  for (const q of golden.questions) {
    const parsed = parseQuery(q.question);
    for (const mode of MODES) {
      const res = await hybridSearch(database.db, embedder, {
        workspaceId: ws!.id,
        principals,
        text: parsed.text,
        filters: parsed.filters,
        mode,
        limit: K,
        embedTimeoutMs: 120_000,
      });
      if (res.degraded) degradedCount++;
      const ranked = res.results.map((r) => idMap.get(r.documentId)!);
      for (const f of q.forbidden ?? []) {
        if (ranked.includes(f)) violations.push(`${q.id} (${mode}) returned forbidden ${f}`);
      }
      if (q.relevant.length) {
        rows.push({ id: q.id, kind: q.kind, mode, ...scoreRanking(ranked, q.relevant, K) });
      }
    }
  }
  // --- Optional: compare keyword weights for hybrid fusion (query embeddings are cached). ---
  if (sweep) {
    console.log(
      '\nKeyword-weight sweep (hybrid):\n\n| Keyword weight | Recall@10 | MRR | nDCG@10 |\n| --- | --- | --- | --- |',
    );
    for (const keywordWeight of SWEEP_WEIGHTS) {
      const scores: ReturnType<typeof scoreRanking>[] = [];
      for (const q of golden.questions.filter((x) => x.relevant.length)) {
        const parsed = parseQuery(q.question);
        const res = await hybridSearch(database.db, embedder, {
          workspaceId: ws!.id,
          principals,
          text: parsed.text,
          filters: parsed.filters,
          mode: 'hybrid',
          limit: K,
          embedTimeoutMs: 120_000,
          keywordWeight,
        });
        scores.push(
          scoreRanking(
            res.results.map((r) => idMap.get(r.documentId)!),
            q.relevant,
            K,
          ),
        );
      }
      const mean = (key: 'recall' | 'rr' | 'ndcg') =>
        (scores.reduce((s, x) => s + x[key], 0) / scores.length).toFixed(3);
      console.log(`| ${keywordWeight} | ${mean('recall')} | ${mean('rr')} | ${mean('ndcg')} |`);
    }
  }

  await database.close();

  // --- Report. ---
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const summary = MODES.map((mode) => {
    const r = rows.filter((x) => x.mode === mode);
    return {
      mode,
      recallAt10: avg(r.map((x) => x.recall)),
      mrr: avg(r.map((x) => x.rr)),
      ndcgAt10: avg(r.map((x) => x.ndcg)),
    };
  });
  const byKind = ['fact', 'paraphrase', 'filter'].map((kind) => ({
    kind,
    recall: Object.fromEntries(
      MODES.map((mode) => [
        mode,
        avg(rows.filter((x) => x.kind === kind && x.mode === mode).map((x) => x.recall)),
      ]),
    ) as Record<SearchMode, number>,
  }));

  const f = (n: number) => n.toFixed(3);
  const table = [
    `| Mode | Recall@10 | MRR | nDCG@10 |`,
    `| --- | --- | --- | --- |`,
    ...summary.map((s) => `| ${s.mode} | ${f(s.recallAt10)} | ${f(s.mrr)} | ${f(s.ndcgAt10)} |`),
    ``,
    `| Question kind | ${MODES.join(' | ')} (Recall@10) |`,
    `| --- | ${MODES.map(() => '---').join(' | ')} |`,
    ...byKind.map((k) => `| ${k.kind} | ${MODES.map((m) => f(k.recall[m])).join(' | ')} |`),
  ].join('\n');

  const answerable = golden.questions.filter((q) => q.relevant.length).length;
  console.log(
    `\n${answerable} answerable questions, ${golden.questions.length - answerable} restricted/unanswerable\n`,
  );
  console.log(table);
  if (degradedCount) console.log(`\n⚠ ${degradedCount} searches fell back to keyword-only`);

  const misses = rows.filter((r) => r.mode === 'hybrid' && r.recall < 1);
  if (misses.length) {
    console.log(`\nHybrid misses (not all relevant docs in top ${K}):`);
    for (const m of misses) {
      const q = golden.questions.find((x) => x.id === m.id)!;
      console.log(`  ${m.id} recall=${f(m.recall)}  "${q.question}"`);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(`${here}results`, { recursive: true });
  writeFileSync(
    `${here}results/${date}-${embedder.model}.json`,
    JSON.stringify({ date, model: embedder.model, summary, byKind, violations, rows }, null, 2),
  );
  writeFileSync(
    `${here}results/latest-${embedder.model}.md`,
    `# Eval ${date} · ${embedder.model}\n\n${table}\n`,
  );

  if (violations.length) {
    console.error(`\n✗ Permission violations:\n  ${violations.join('\n  ')}`);
    process.exit(1);
  }
  const hybrid = summary.find((s) => s.mode === 'hybrid')!;
  if (!Number.isNaN(minRecall) && hybrid.recallAt10 < minRecall) {
    console.error(`\n✗ Hybrid Recall@10 ${f(hybrid.recallAt10)} is below the minimum ${minRecall}`);
    process.exit(1);
  }
  console.log('\n✓ No permission violations');
}

await main();
