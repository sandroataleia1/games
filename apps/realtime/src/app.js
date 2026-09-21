import cors from "cors";
import express from "express";

export function createApp({ healthChecker, webOrigin }) {
  const app = express();
  app.use(cors({ origin: webOrigin }));
  app.get("/health", async (_request, response) => {
    const health = await healthChecker();
    response.status(health.status === "ok" ? 200 : 503).json(health);
  });
  return app;
}
