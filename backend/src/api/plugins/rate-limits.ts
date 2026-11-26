import type { FastifyRequest } from 'fastify';
import { API_KEY_HEADER } from '../../auth/api-keys.js';
import { sha256 } from '../../shared/crypto.js';

/**
 * Per-route limits counted separately for each API key (by a hash of the key, never the key
 * itself) and, for browser users, per IP address.
 */
export function apiRateLimit(limits: { perUser: number; perKey: number }) {
  const keyOf = (req: FastifyRequest) => req.headers[API_KEY_HEADER];
  return {
    timeWindow: '1 minute',
    max: (req: FastifyRequest) => (keyOf(req) ? limits.perKey : limits.perUser),
    keyGenerator: (req: FastifyRequest) => {
      const key = keyOf(req);
      return typeof key === 'string' && key ? `key:${sha256(key).slice(0, 24)}` : `ip:${req.ip}`;
    },
  };
}
