import cors from "cors";
import express from "express";
import { installApi } from "./api.js";

export function createApp({ healthChecker, webOrigin, database, production }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", async (_request, response) => {
    const health = await healthChecker();
    response.status(health.status === "ok" ? 200 : 503).json(health);
  });
  if (database) installApi(app, { database, webOrigin, production });
  return app;
}
