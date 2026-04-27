import { NextFunction, Request, Response } from "express";
import { appConfig } from "../config.js";
import { AuthService, publicUser } from "../services/auth/AuthService.js";
import { AuthSession, Classroom, LectureItem, User, Week } from "../types/domain.js";
import type { ServerDeps } from "../bootstrap.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      authSession?: AuthSession;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    result[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return result;
}

export function getAuthToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[appConfig.authCookieName];
}

function cookieBaseOptions(): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function setAuthCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${appConfig.authCookieName}=${encodeURIComponent(token)}; ${cookieBaseOptions()}; Max-Age=${
      appConfig.authSessionTtlDays * 24 * 60 * 60
    }`
  );
}

export function clearAuthCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${appConfig.authCookieName}=; ${cookieBaseOptions()}; Max-Age=0`
  );
}

export function loadAuth(auth: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const resolved = await auth.resolveSessionToken(getAuthToken(req));
      if (resolved) {
        req.authUser = resolved.user;
        req.authSession = resolved.session;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireSameOriginForUnsafeMethods(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
    next();
    return;
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const allowedOrigins = getAllowedLocalhostOriginAliases(appConfig.appOrigin);
  if (
    (origin && allowedOrigins.includes(origin)) ||
    (referer && allowedOrigins.some((allowed) => referer.startsWith(`${allowed}/`)))
  ) {
    next();
    return;
  }

  res.status(403).json({ ok: false, error: "Invalid request origin", code: "BAD_ORIGIN" });
}

function getAllowedLocalhostOriginAliases(origin: string): string[] {
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "localhost") {
      return [origin, `${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ""}`];
    }
    if (parsed.hostname === "127.0.0.1") {
      return [origin, `${parsed.protocol}//localhost${parsed.port ? `:${parsed.port}` : ""}`];
    }
  } catch {
    // fall through
  }
  return [origin];
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ ok: false, error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  next();
}

export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser?.emailVerifiedAt) {
    res.status(403).json({
      ok: false,
      error: "Email verification required",
      code: "EMAIL_NOT_VERIFIED",
      user: req.authUser ? publicUser(req.authUser) : undefined
    });
    return;
  }
  next();
}

export function requireTeacher(req: Request, res: Response, next: NextFunction): void {
  if (req.authUser?.role !== "teacher") {
    res.status(403).json({ ok: false, error: "Teacher role required", code: "TEACHER_ONLY" });
    return;
  }
  next();
}

export async function canReadClassroom(deps: ServerDeps, user: User, classroomId: string) {
  const classroom = await deps.store.getClassroom(classroomId);
  if (!classroom) return { ok: false as const, status: 404, error: "Classroom not found" };
  if (user.role === "teacher") {
    return classroom.teacherId === user.id
      ? { ok: true as const, classroom }
      : { ok: false as const, status: 403, error: "Forbidden" };
  }
  const enrolled = await deps.store.isStudentEnrolled(classroomId, user.id);
  return enrolled
    ? { ok: true as const, classroom }
    : { ok: false as const, status: 403, error: "Forbidden" };
}

export async function requireClassroomReadable(
  deps: ServerDeps,
  req: Request,
  res: Response,
  classroomId: string
): Promise<Classroom | null> {
  if (!req.authUser) {
    res.status(401).json({ ok: false, error: "Authentication required" });
    return null;
  }
  const access = await canReadClassroom(deps, req.authUser, classroomId);
  if (!access.ok) {
    res.status(access.status).json({ ok: false, error: access.error });
    return null;
  }
  return access.classroom;
}

export async function requireClassroomOwner(
  deps: ServerDeps,
  req: Request,
  res: Response,
  classroomId: string
): Promise<Classroom | null> {
  if (!req.authUser) {
    res.status(401).json({ ok: false, error: "Authentication required" });
    return null;
  }
  const classroom = await deps.store.getClassroom(classroomId);
  if (!classroom) {
    res.status(404).json({ ok: false, error: "Classroom not found" });
    return null;
  }
  if (req.authUser.role !== "teacher" || classroom.teacherId !== req.authUser.id) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return null;
  }
  return classroom;
}

export async function requireWeekReadable(
  deps: ServerDeps,
  req: Request,
  res: Response,
  weekId: string
): Promise<Week | null> {
  const week = await deps.store.getWeek(weekId);
  if (!week) {
    res.status(404).json({ ok: false, error: "Week not found" });
    return null;
  }
  const classroom = await requireClassroomReadable(deps, req, res, week.classroomId);
  return classroom ? week : null;
}

export async function requireWeekWritable(
  deps: ServerDeps,
  req: Request,
  res: Response,
  weekId: string
): Promise<Week | null> {
  const week = await deps.store.getWeek(weekId);
  if (!week) {
    res.status(404).json({ ok: false, error: "Week not found" });
    return null;
  }
  const classroom = await requireClassroomOwner(deps, req, res, week.classroomId);
  return classroom ? week : null;
}

export async function requireLectureReadable(
  deps: ServerDeps,
  req: Request,
  res: Response,
  lectureId: string
): Promise<LectureItem | null> {
  const lecture = await deps.store.getLecture(lectureId);
  if (!lecture) {
    res.status(404).json({ ok: false, error: "Lecture not found" });
    return null;
  }
  const week = await requireWeekReadable(deps, req, res, lecture.weekId);
  return week ? lecture : null;
}

export async function requireLectureWritable(
  deps: ServerDeps,
  req: Request,
  res: Response,
  lectureId: string
): Promise<LectureItem | null> {
  const lecture = await deps.store.getLecture(lectureId);
  if (!lecture) {
    res.status(404).json({ ok: false, error: "Lecture not found" });
    return null;
  }
  const week = await requireWeekWritable(deps, req, res, lecture.weekId);
  return week ? lecture : null;
}
