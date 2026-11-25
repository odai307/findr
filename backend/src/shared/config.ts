import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at startup.
 * If anything is missing or malformed the process exits with a clear message (fail fast).
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** `FOO=` in a .env file means "not set", not "set to an empty string". */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
);

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /**
     * `pglite:./.data/pglite` runs an embedded Postgres inside the API process (no install needed).
     * `pglite:memory` is a throwaway in-memory database (used by tests).
     * `postgres://...` connects to a real Postgres server such as Neon.
     */
    DATABASE_URL: z
      .string()
      .refine((v) => v.startsWith('pglite:') || /^postgres(ql)?:\/\//.test(v), {
        message: 'must start with pglite: or postgres://',
      }),

    /** Public URL of the web app, e.g. http://localhost:5173 or https://app.example.com */
    WEB_ORIGIN: z.url(),
    /** Public URL the browser uses to reach the API. Same as WEB_ORIGIN in dev (Vite proxy). */
    API_PUBLIC_URL: z.url(),

    /** Ed25519 key pair for signing access tokens, as base64-encoded JWK JSON. See `pnpm gen:keys`. */
    JWT_PRIVATE_KEY: z.string().min(1),
    JWT_PUBLIC_KEY: z.string().min(1),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    /** Lets you sign in by email without Google, for local development only. */
    DEV_LOGIN_ENABLED: bool,

    /**
     * Redis for the BullMQ job queues (e.g. an Upstash rediss:// URL). When unset in development,
     * sync jobs run inside the API process instead, so no Redis is needed locally.
     */
    REDIS_URL: optionalString.pipe(
      z
        .string()
        .regex(/^rediss?:\/\//)
        .optional(),
    ),

    /** For embeddings. When unset in development, a local fake embedder is used (keyword-ish only). */
    OPENAI_API_KEY: optionalString,
    EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && c.DEV_LOGIN_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_LOGIN_ENABLED'],
        message: 'must be false in production',
      });
    }
    if (c.NODE_ENV === 'production' && !c.REDIS_URL) {
      ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'is required in production' });
    }
    if (c.NODE_ENV === 'production' && !c.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'is required in production',
      });
    }
    if (Boolean(c.GOOGLE_CLIENT_ID) !== Boolean(c.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Loads backend/.env (if present) into process.env, then validates. */
export function loadConfig(): Config {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the real environment (CI, hosting provider).
  }
  return parseConfig(process.env);
}
