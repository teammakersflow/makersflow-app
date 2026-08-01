import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { rateLimit } from "./middlewares/rateLimit";
import { logger } from "./lib/logger";
import { loadAndValidateConfig } from "./config/authConfig";
import { globalErrorHandler } from "./middlewares/errorHandler";

// Fail-fast configuration validation at server startup
loadAndValidateConfig();

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Keep the raw body so the Razorpay webhook can verify its HMAC signature
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 120;
app.use(rateLimit({ windowMs: rateLimitWindowMs, max: rateLimitMax }));

// Mount router at both root and /api for compatibility
app.use(router);
app.use("/api", router);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
