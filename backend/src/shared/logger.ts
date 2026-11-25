import pino, { type LoggerOptions } from 'pino';
import type { Config } from './config.js';

/** Field paths whose values are replaced with [REDACTED] in every log line. */
export const redactPaths = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'cookie',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function loggerOptions(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): LoggerOptions {
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    // Human-readable output locally; plain JSON (one object per line) in production.
    ...(config.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  };
}

export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>) {
  return pino(loggerOptions(config));
}
