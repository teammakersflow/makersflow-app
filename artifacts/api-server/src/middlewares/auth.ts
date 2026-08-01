import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../lib/jwt';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Express middleware checking Authorization: Bearer <accessToken>
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Authentication token required.',
      errorCode: 'UNAUTHORIZED',
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err: any) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired access token.',
      errorCode: 'UNAUTHORIZED',
    });
  }
}
