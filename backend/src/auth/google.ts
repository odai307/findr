import { Google, generateCodeVerifier, generateState } from 'arctic';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from '../shared/errors.js';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  /** Google Workspace domain, only present for Workspace accounts. Used later for domain: principals. */
  hostedDomain: string | null;
}

export interface GoogleAuth {
  createAuthorization(): { url: string; state: string; codeVerifier: string };
  exchange(code: string, codeVerifier: string): Promise<GoogleProfile>;
}

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Google sign-in via OpenID Connect, with PKCE. */
export function createGoogleAuth(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): GoogleAuth {
  const google = new Google(opts.clientId, opts.clientSecret, opts.redirectUri);

  return {
    createAuthorization() {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const url = google.createAuthorizationURL(state, codeVerifier, [
        'openid',
        'email',
        'profile',
      ]);
      url.searchParams.set('prompt', 'select_account');
      return { url: url.toString(), state, codeVerifier };
    },

    async exchange(code, codeVerifier) {
      let idToken: string;
      try {
        const tokens = await google.validateAuthorizationCode(code, codeVerifier);
        idToken = tokens.idToken();
      } catch {
        throw new AppError('OAUTH_FAILED', 'Google sign-in failed.');
      }

      // Verify Google's signature, issuer and audience before trusting any claim.
      const { payload } = await jwtVerify(idToken, googleJwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: opts.clientId,
      }).catch(() => {
        throw new AppError('OAUTH_FAILED', 'Google returned an invalid identity token.');
      });

      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        throw new AppError('OAUTH_FAILED', 'Google did not return an email address.');
      }
      if (payload.email_verified !== true) {
        throw new AppError('OAUTH_FAILED', 'Your Google email address is not verified.');
      }
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        name: typeof payload.name === 'string' ? payload.name : payload.email,
        picture: typeof payload.picture === 'string' ? payload.picture : null,
        hostedDomain: typeof payload.hd === 'string' ? payload.hd : null,
      };
    },
  };
}
