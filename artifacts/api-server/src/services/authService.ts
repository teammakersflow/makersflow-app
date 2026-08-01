import { GoogleAuthProvider } from '../providers/googleAuthProvider';
import { userRepository } from '../repositories/userRepository';
import { sessionRepository } from '../repositories/sessionRepository';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';

export interface AuthLoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    name: string;
    email: string;
    profileImage?: string;
    role: string;
  };
}

export interface AuthRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const authService = {
  /**
   * Google ID Token login / signup handler
   */
  async loginWithGoogle(idToken: string): Promise<AuthLoginResult> {
    const googleProvider = new GoogleAuthProvider();
    const googleProfile = await googleProvider.verifyToken(idToken);

    // Primary Identity Lookup: Google Subject ID
    let user = await userRepository.findByGoogleSubjectId(googleProfile.providerSubjectId);

    if (!user) {
      // Secondary Identity Lookup: Email fallback for account linking
      user = await userRepository.findByEmail(googleProfile.email);
      if (user) {
        // Link Google Subject ID to existing profile
        user = await userRepository.linkGoogleSubjectId(user.id, googleProfile.providerSubjectId, {
          fullName: googleProfile.name,
          avatarUrl: googleProfile.picture,
        });
      } else {
        // Create fresh profile
        user = await userRepository.createUser({
          email: googleProfile.email,
          fullName: googleProfile.name,
          avatarUrl: googleProfile.picture,
          googleSub: googleProfile.providerSubjectId,
          role: 'student',
        });
      }
    }

    // Create session and issue tokens
    const session = await sessionRepository.createSession(user.id, 'init_token');
    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role || 'student',
      sessionId: session.sessionId,
    };

    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    // Update session with actual initial refresh token hash
    await sessionRepository.validateAndRotateSession(session.sessionId, 'init_token', refreshToken);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        name: user.full_name || user.email.split('@')[0],
        email: user.email,
        profileImage: user.avatar_url || undefined,
        role: user.role || 'student',
      },
    };
  },

  /**
   * Refresh session tokens
   */
  async refreshSessionTokens(refreshToken: string): Promise<AuthRefreshResult> {
    const payload = verifyRefreshToken(refreshToken);
    const user = await userRepository.findById(payload.sub);

    if (!user) {
      throw new Error('User account associated with token no longer exists.');
    }

    const newPayload = {
      sub: user.id,
      email: user.email,
      role: user.role || 'student',
      sessionId: payload.sessionId,
    };

    const newAccessToken = signAccessToken(newPayload);
    const newRefreshToken = signRefreshToken(newPayload);

    const rotated = await sessionRepository.validateAndRotateSession(payload.sessionId, refreshToken, newRefreshToken);
    if (!rotated) {
      throw new Error('Refresh token has been invalidated or revoked.');
    }

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900,
    };
  },

  /**
   * Fetch authenticated user details
   */
  async getUserProfile(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new Error('User profile not found.');
    }

    return {
      id: user.id,
      name: user.full_name || user.email.split('@')[0],
      email: user.email,
      profileImage: user.avatar_url || undefined,
      role: user.role || 'student',
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  },

  /**
   * Revoke session on logout
   */
  async logoutSession(sessionId: string): Promise<void> {
    await sessionRepository.revokeSession(sessionId);
  },
};
