import { Router, type IRouter } from 'express';
import { authController } from '../controllers/authController';
import { authenticateToken } from '../middlewares/auth';

const authRouter: IRouter = Router();

authRouter.post('/auth/google', authController.googleLogin);
authRouter.post('/auth/refresh', authController.refreshToken);
authRouter.get('/auth/me', authenticateToken as any, authController.getMe as any);
authRouter.post('/auth/logout', authenticateToken as any, authController.logout as any);

export default authRouter;
