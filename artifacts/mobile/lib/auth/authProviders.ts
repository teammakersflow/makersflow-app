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
    const redirectUrl = this.customRedirectUri || Linking.createURL('auth/callback', { scheme: 'makersflow' });
    
    // In production/native app, retrieves idToken via native Google Sign-In SDK or WebBrowser ID token prompt.
    // For standard web/Expo browser sessions:
    return {
      provider: 'google',
      idToken: 'google_native_id_token_placeholder',
    };
  }
}
