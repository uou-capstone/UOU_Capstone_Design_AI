import cors from "cors";
import express from "express";
import path from "node:path";
import { appConfig } from "./config.js";
import { createServerDeps } from "./bootstrap.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { classroomsRouter } from "./routes/classrooms.js";
import { lecturesRouter } from "./routes/lectures.js";
import { sessionRouter } from "./routes/session.js";
import { weeksRouter } from "./routes/weeks.js";

async function bootstrap() {
  const deps = await createServerDeps();
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use("/uploads", express.static(path.resolve(appConfig.uploadDir)));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  app.use("/api/classrooms", classroomsRouter(deps));
  app.use("/api", weeksRouter(deps));
  app.use("/api", lecturesRouter(deps));
  app.use("/api", sessionRouter(deps));

  app.use(errorHandler);

  app.listen(appConfig.port, () => {
    console.log(`[server] listening on http://localhost:${appConfig.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
