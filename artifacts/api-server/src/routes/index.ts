import { Router, type IRouter } from "express";
import healthRouter from "./health";
import razorpayRouter from "./razorpay";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(razorpayRouter);
router.use(authRouter);

export default router;
