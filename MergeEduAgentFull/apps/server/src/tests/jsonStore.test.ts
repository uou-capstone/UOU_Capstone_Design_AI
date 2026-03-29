import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testDir = path.resolve(process.cwd(), "apps/server/data-test");

beforeEach(async () => {
  process.env.PORT = "4000";
  process.env.MODEL_NAME = "gemini-1.5-pro";
  process.env.GOOGLE_API_KEY = "test-key";
  process.env.PASS_SCORE_RATIO = "0.7";
  process.env.CONTEXT_MAX_CHARS = "12000";
  process.env.RECENT_MESSAGES_N = "12";
  process.env.AI_BRIDGE_URL = "http://127.0.0.1:8001";
  process.env.DATA_DIR = "./apps/server/data-test";
  process.env.UPLOAD_DIR = "./apps/server/uploads-test";
  await fs.rm(testDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("JsonStore", () => {
  it("creates and restores session", async () => {
    const { JsonStore } = await import("../services/storage/JsonStore.js");
    const store = new JsonStore();
    await store.init();

    const classroom = await store.createClassroom("테스트");
    const week = await store.createWeek(classroom.id);
    await store.createLecture({
      id: "lec_test",
      weekId: week.id,
      title: "샘플",
      pdfPath: "/tmp/sample.pdf",
      numPages: 1,
      pageIndexPath: "/tmp/sample.pageIndex.json"
    });

    const session = await store.getOrCreateSessionByLecture("lec_test");
    await store.saveSession(session);
    const loaded = await store.getSession(session.sessionId);

    expect(loaded?.sessionId).toBe(session.sessionId);
  });
});
