import cors from "cors";
import express from "express";
import { appConfig } from "./config.js";
import { ServerDeps } from "./bootstrap.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { loadAuth, requireSameOriginForUnsafeMethods } from "./middleware/auth.js";
import { requestEncryptionMiddleware } from "./middleware/requestEncryption.js";
import { authRouter } from "./routes/auth.js";
import { classroomsRouter } from "./routes/classrooms.js";
import { lecturesRouter } from "./routes/lectures.js";
import { sessionRouter } from "./routes/session.js";
import { studentsRouter } from "./routes/students.js";
import { uploadsRouter } from "./routes/uploads.js";
import { weeksRouter } from "./routes/weeks.js";

export function createApp(deps: ServerDeps) {
  const app = express();

  app.use(
    cors({
      origin: appConfig.appOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(requestEncryptionMiddleware(deps.requestEncryption));
  app.use(loadAuth(deps.auth));
  app.use(requireSameOriginForUnsafeMethods);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  app.get("/api/crypto/request-key", (_req, res) => {
    res.json({ ok: true, data: deps.requestEncryption.getRequestKeyInfo() });
  });

  app.use("/api/auth", authRouter(deps));
  app.use("/api", uploadsRouter(deps));
  app.use("/api", studentsRouter(deps));
  app.use("/api/classrooms", classroomsRouter(deps));
  app.use("/api", weeksRouter(deps));
  app.use("/api", lecturesRouter(deps));
  app.use("/api", sessionRouter(deps));

  app.use(errorHandler);

  return app;
}
