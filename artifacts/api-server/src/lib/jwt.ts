import jwt from 'jsonwebtoken';
import { loadAndValidateConfig } from '../config/authConfig';

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  sessionId: string;
  iss?: string;
  aud?: string;
}

export function signAccessToken(payload: Omit<TokenPayload, 'iss' | 'aud'>): string {
  const config = loadAndValidateConfig();
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.accessTokenExpiresIn,
    issuer: 'makersflow-api-server',
    audience: 'makersflow-mobile-app',
  });
}

export function signRefreshToken(payload: Omit<TokenPayload, 'iss' | 'aud'>): string {
  const config = loadAndValidateConfig();
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.refreshTokenExpiresIn,
    issuer: 'makersflow-api-server',
    audience: 'makersflow-mobile-app',
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  const config = loadAndValidateConfig();
  return jwt.verify(token, config.jwtSecret, {
    issuer: 'makersflow-api-server',
    audience: 'makersflow-mobile-app',
  }) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  const config = loadAndValidateConfig();
  return jwt.verify(token, config.jwtRefreshSecret, {
    issuer: 'makersflow-api-server',
    audience: 'makersflow-mobile-app',
  }) as TokenPayload;
}
