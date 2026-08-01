import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth';
import { authService } from '../services/authService';
import { AppError } from '../middlewares/errorHandler';

export const authController = {
  /**
   * POST /auth/google
   */
  async googleLogin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { idToken } = req.body;
      if (!idToken || typeof idToken !== 'string') {
        throw new AppError(400, 'Request body must contain a valid idToken string.', 'BAD_REQUEST');
      }

      const data = await authService.loginWithGoogle(idToken);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data,
      });
    } catch (err: any) {
      if (err instanceof AppError) return next(err);
      next(new AppError(401, err.message || 'Google authentication failed.', 'UNAUTHORIZED'));
    }
  },

  /**
   * POST /auth/refresh
   */
  async refreshToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken || typeof refreshToken !== 'string') {
        throw new AppError(400, 'Request body must contain a valid refreshToken string.', 'BAD_REQUEST');
      }

      const data = await authService.refreshSessionTokens(refreshToken);

      res.status(200).json({
        success: true,
        message: 'Token refreshed',
        data,
      });
    } catch (err: any) {
      if (err instanceof AppError) return next(err);
      next(new AppError(401, err.message || 'Invalid or expired refresh token.', 'UNAUTHORIZED'));
    }
  },

  /**
   * GET /auth/me
   */
  async getMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.sub) {
        throw new AppError(401, 'Authentication token invalid.', 'UNAUTHORIZED');
      }

      const data = await authService.getUserProfile(req.user.sub);

      res.status(200).json({
        success: true,
        message: 'User fetched successfully',
        data,
      });
    } catch (err: any) {
      if (err instanceof AppError) return next(err);
      next(new AppError(404, err.message || 'User profile not found.', 'NOT_FOUND'));
    }
  },

  /**
   * POST /auth/logout
   */
  async logout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (req.user?.sessionId) {
        await authService.logoutSession(req.user.sessionId);
      }
      res.status(200).json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (err: any) {
      next(err);
    }
  },
};
