import { z } from "zod";
import {
  gradingSchema,
  orchestratorPlanSchema,
  quizSchema,
  studentCompetencyReportSchema
} from "../../types/guards.js";

export function parseOrchestratorPlan(input: unknown) {
  return orchestratorPlanSchema.parse(input);
}

export function parseQuizJson(input: unknown) {
  return quizSchema.parse(input);
}

export function parseGrading(input: unknown) {
  return gradingSchema.parse(input);
}

export function parseStudentCompetencyReport(input: unknown) {
  return studentCompetencyReportSchema.parse(input);
}

export function safeParse<T>(schema: z.ZodType<T>, input: unknown): T | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
