import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

WebBrowser.maybeCompleteAuthSession();

export type AuthProviderType = 'google' | 'apple' | 'email' | 'otp';

export interface AuthCredentials {
  provider: AuthProviderType;
  idToken?: string;
  email?: string;
  password?: string;
}

export interface IAuthProvider {
  readonly type: AuthProviderType;
  authenticate(): Promise<AuthCredentials>;
}

/**
 * Google Auth Provider Strategy
 */
export class GoogleAuthProvider implements IAuthProvider {
  readonly type: AuthProviderType = 'google';

  constructor(private customRedirectUri?: string) {}

  async authenticate(): Promise<AuthCredentials> {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

    if (!clientId || clientId.trim() === '') {
      throw new Error(
        'Google authentication is not configured: EXPO_PUBLIC_GOOGLE_CLIENT_ID is missing from the mobile environment.'
      );
    }

    const redirectUrl = this.customRedirectUri || Linking.createURL('auth/callback', { scheme: 'makersflow' });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUrl,
      response_type: 'id_token',
      scope: 'openid email profile',
      nonce: Math.random().toString(36).substring(2),
    }).toString();

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

    if (result.type === 'success' && result.url) {
      const hashFragment = result.url.includes('#') ? result.url.split('#')[1] : '';
      const queryString = result.url.includes('?') ? result.url.split('?')[1].split('#')[0] : '';
      const params = new URLSearchParams(hashFragment || queryString);
      const idToken = params.get('id_token') || params.get('idToken');

      if (idToken) {
        return { provider: 'google', idToken };
      }

      throw new Error('Failed to retrieve Google ID token from OAuth callback.');
    }

    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Google sign-in was cancelled by the user.');
    }

    throw new Error('Google sign-in could not be completed.');
  }
}

