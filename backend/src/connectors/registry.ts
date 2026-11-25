import { createDemoConnector } from './demo/index.js';
import type { Connector } from './types.js';

export type ConnectorRegistry = (provider: string) => Connector;

/** Maps a provider name to its connector. Real providers (Drive, Slack…) are added in later phases. */
export function defaultConnectorRegistry(): ConnectorRegistry {
  const demo = createDemoConnector();
  return (provider) => {
    if (provider === 'demo') return demo;
    throw new Error(`No connector for provider "${provider}"`);
  };
}
