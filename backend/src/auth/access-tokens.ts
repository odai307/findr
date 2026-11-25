import { SignJWT, errors, importJWK, jwtVerify, type JWK } from 'jose';
import { AppError } from '../shared/errors.js';

const ALG = 'EdDSA';
const ISSUER = 'findr';
const AUDIENCE = 'findr-api';

export interface AccessTokenService {
  sign(userId: string): Promise<{ accessToken: string; expiresIn: number }>;
  verify(token: string): Promise<{ userId: string }>;
}

function decodeJwk(base64: string): JWK {
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as JWK;
}

/**
 * Short-lived (15 min) access tokens, signed with an Ed25519 private key.
 * The frontend keeps them in memory only, never in localStorage.
 */
export async function createAccessTokenService(opts: {
  privateKey: string;
  publicKey: string;
  ttlSeconds: number;
}): Promise<AccessTokenService> {
  const privateKey = await importJWK(decodeJwk(opts.privateKey), ALG);
  const publicKey = await importJWK(decodeJwk(opts.publicKey), ALG);

  return {
    async sign(userId) {
      const accessToken = await new SignJWT({})
        .setProtectedHeader({ alg: ALG })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${opts.ttlSeconds}s`)
        .sign(privateKey);
      return { accessToken, expiresIn: opts.ttlSeconds };
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
        });
        if (!payload.sub) throw new AppError('UNAUTHENTICATED', 'Invalid access token.');
        return { userId: payload.sub };
      } catch (err) {
        if (err instanceof errors.JWTExpired) {
          throw new AppError('TOKEN_EXPIRED', 'Access token expired.');
        }
        if (err instanceof AppError) throw err;
        throw new AppError('UNAUTHENTICATED', 'Invalid access token.');
      }
    },
  };
}
