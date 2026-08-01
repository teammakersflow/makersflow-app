import crypto from 'crypto';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export interface ActiveSession {
  sessionId: string;
  userId: string;
  refreshTokenHash: string;
  createdAt: string;
  revokedAt?: string | null;
}

// In-memory token hash store with database sync for high performance and multi-device revocation
const tokenHashStore = new Map<string, ActiveSession>();

export const sessionRepository = {
  hashToken(refreshToken: string): string {
    return crypto.createHash('sha256').update(refreshToken).digest('hex');
  },

  generateSessionId(): string {
    return `ses_${crypto.randomUUID()}`;
  },

  async createSession(userId: string, refreshToken: string): Promise<ActiveSession> {
    const sessionId = this.generateSessionId();
    const refreshTokenHash = this.hashToken(refreshToken);
    const createdAt = new Date().toISOString();

    const session: ActiveSession = {
      sessionId,
      userId,
      refreshTokenHash,
      createdAt,
      revokedAt: null,
    };

    tokenHashStore.set(sessionId, session);

    // Sync active session ID to Supabase profiles table for single-device tracking
    try {
      const supabase = getSupabaseAdmin();
      await supabase
        .from('profiles')
        .update({ active_session_id: sessionId, updated_at: createdAt })
        .eq('id', userId);
    } catch (e: any) {
      console.warn('[SessionRepository] Failed to sync active_session_id to DB:', e?.message);
    }

    return session;
  },

  async validateAndRotateSession(sessionId: string, currentRefreshToken: string, newRefreshToken: string): Promise<boolean> {
    const session = tokenHashStore.get(sessionId);
    const currentHash = this.hashToken(currentRefreshToken);

    if (!session) {
      // If server restarted, create new session entry
      tokenHashStore.set(sessionId, {
        sessionId,
        userId: 'unknown',
        refreshTokenHash: this.hashToken(newRefreshToken),
        createdAt: new Date().toISOString(),
      });
      return true;
    }

    if (session.revokedAt) {
      console.warn(`[SessionRepository] Replay attempt detected on revoked session: ${sessionId}`);
      return false;
    }

    if (session.refreshTokenHash !== currentHash) {
      console.warn(`[SessionRepository] Refresh token mismatch for session: ${sessionId}. Revoking family.`);
      session.revokedAt = new Date().toISOString();
      return false;
    }

    // Rotate token hash
    session.refreshTokenHash = this.hashToken(newRefreshToken);
    return true;
  },

  async revokeSession(sessionId: string): Promise<void> {
    const session = tokenHashStore.get(sessionId);
    if (session) {
      session.revokedAt = new Date().toISOString();
    }
  },

  async revokeAllUserSessions(userId: string): Promise<void> {
    for (const [_, session] of tokenHashStore.entries()) {
      if (session.userId === userId) {
        session.revokedAt = new Date().toISOString();
      }
    }
  },
};
