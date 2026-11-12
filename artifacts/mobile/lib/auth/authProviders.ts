import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

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
 *
 * Uses native Google Sign-In on Android/iOS.
 * The web OAuth client ID is supplied so Google returns an ID token
 * that can be sent to the MakersFlow backend.
 */
export class GoogleAuthProvider implements IAuthProvider {
  readonly type: AuthProviderType = 'google';

  async authenticate(): Promise<AuthCredentials> {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

    if (!webClientId || webClientId.trim() === '') {
      throw new Error(
        'Google authentication is not configured: EXPO_PUBLIC_GOOGLE_CLIENT_ID is missing from the mobile environment.'
      );
    }

    // L-26: no production logging in the auth path.
    if (__DEV__) console.log('[GoogleAuth] Configuring native Google Sign-In');

    GoogleSignin.configure({
      webClientId,
      scopes: ['openid', 'email', 'profile'],
    });

    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });

      const response = await GoogleSignin.signIn();

      if (response.type !== 'success') {
        throw new Error('Google sign-in was cancelled by the user.');
      }

      const idToken = response.data.idToken;

      if (!idToken) {
        throw new Error('Google Sign-In succeeded, but no ID token was returned.');
      }

      if (__DEV__) console.log('[GoogleAuth] Native Google Sign-In successful');

      return {
        provider: 'google',
        idToken,
        email: response.data.user.email,
      };
    } catch (error: any) {
      if (error?.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new Error('Google sign-in was cancelled by the user.');
      }

      if (error?.code === statusCodes.IN_PROGRESS) {
        throw new Error('Google sign-in is already in progress.');
      }

      if (error?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play Services are not available or need to be updated.');
      }

      if (__DEV__) console.error('[GoogleAuth] Native Google Sign-In error:', error?.code ?? error?.message);
      throw new Error(error?.message || 'Google sign-in could not be completed.');
    }
  }
}

/**
 * M-11 (2026-11-10): sign out of the native Google session on app logout, so the
 * next sign-in shows the account chooser instead of silently reusing the
 * previous Google account. Best effort; never blocks logout.
 */
export async function signOutOfGoogle(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // not signed in with Google / module unavailable
  }
}
