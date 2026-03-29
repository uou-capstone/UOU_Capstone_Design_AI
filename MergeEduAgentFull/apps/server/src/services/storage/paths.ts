import path from "node:path";
import { appConfig } from "../../config.js";

export const paths = {
  classrooms: path.join(appConfig.dataDir, "classrooms.json"),
  weeks: path.join(appConfig.dataDir, "weeks.json"),
  lectures: path.join(appConfig.dataDir, "lectures.json"),
  quizResults: path.join(appConfig.dataDir, "quiz-results.json"),
  sessionsDir: path.join(appConfig.dataDir, "sessions"),
  uploadsDir: appConfig.uploadDir
} as const;
