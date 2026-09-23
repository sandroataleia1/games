import cors from "cors";
import express from "express";
import { installApi } from "./api.js";
import { parseWebOrigins } from "./origins.js";

export function createApp({ healthChecker, webOrigin, database, production, rateLimiter, trustProxy = false }) {
  const app = express();
  const origins = parseWebOrigins(webOrigin);
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy ? 1 : false);
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes(origin)), credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", async (_request, response) => {
    const health = await healthChecker();
    response.status(health.status === "ok" ? 200 : 503).json(health);
  });
  if (database) installApi(app, { database, webOrigin: origins, production, rateLimiter });
  return app;
}
