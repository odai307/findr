import type { Connector, SourceDocument, SyncBatch, SyncContext } from '../types.js';
import { allDemoDocs, type DemoDoc } from './data.js';

const BATCH_SIZE = 25;
/** Bump when the demo dataset changes, so incremental syncs know to re-list. */
const DATASET_VERSION = 1;

function principalsFor(doc: DemoDoc, ctx: SyncContext): string[] {
  switch (doc.access) {
    case 'workspace':
      return [`workspace:${ctx.workspaceId}`];
    case 'owner':
      return [`user:${ctx.ownerUserId}`];
    case 'leadership':
      return ['group:demo:leadership'];
  }
}

function toSource(doc: DemoDoc, ctx: SyncContext): SourceDocument {
  const date = new Date(doc.date);
  return {
    externalId: doc.id,
    type: doc.type,
    title: doc.title,
    url: `https://demo.findr.example/${doc.type}/${doc.id}`,
    author: doc.author,
    container: doc.container,
    createdAt: date,
    updatedAt: date,
    acl: principalsFor(doc, ctx),
    content: { kind: 'text', text: doc.text, format: doc.format },
  };
}

interface DemoCursor {
  offset: number;
}

/**
 * Serves the fictional Tamarind Labs dataset. Behaves like a paginated provider API, so it
 * exercises the same sync engine paths (batching, cursors, resume) as real connectors.
 */
export function createDemoConnector(docs: DemoDoc[] = allDemoDocs()): Connector {
  return {
    provider: 'demo',

    async getIncrementalCursor() {
      return { version: DATASET_VERSION };
    },

    async *fullSync(ctx, resumeCursor) {
      let offset = (resumeCursor as DemoCursor | undefined)?.offset ?? 0;
      while (offset < docs.length) {
        ctx.signal.throwIfAborted();
        const page = docs.slice(offset, offset + BATCH_SIZE);
        offset += page.length;
        yield {
          upserts: page.map((d) => toSource(d, ctx)),
          deletions: [],
          cursor: { offset } satisfies DemoCursor,
        } satisfies SyncBatch;
      }
    },

    async *incrementalSync(_ctx, cursor) {
      // The dataset is static, so there is never anything new.
      yield { upserts: [], deletions: [], cursor };
    },
  };
}
