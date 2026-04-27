import crypto from "node:crypto";
import { Router } from "express";
import { appConfig } from "../config.js";
import { ServerDeps } from "../bootstrap.js";
import { AuthError, publicUser } from "../services/auth/AuthService.js";
import {
  clearAuthCookie,
  requireAuth,
  requireTeacher,
  requireVerifiedEmail,
  setAuthCookie
} from "../middleware/auth.js";
import { UserRole } from "../types/domain.js";

function handleAuthError(res: any, error: unknown): boolean {
  if (error instanceof AuthError) {
    res.status(error.status).json({
      ok: false,
      error: error.message,
      code: error.code
    });
    return true;
  }
  return false;
}

function parseRole(value: unknown): UserRole | null {
  return value === "teacher" || value === "student" ? value : null;
}

export function authRouter(deps: ServerDeps): Router {
  const router = Router();

  async function register(req: any, res: any, next: any) {
    try {
      const role = parseRole(req.body?.role);
      if (!role) {
        throw new AuthError("역할을 선택해 주세요.", 400, "INVALID_ROLE");
      }
      const result = await deps.auth.register({
        email: String(req.body?.email ?? ""),
        password: String(req.body?.password ?? ""),
        displayName: String(req.body?.displayName ?? ""),
        role
      });
      res.status(201).json({ ok: true, data: { user: result.user }, devVerificationCode: result.devVerificationCode });
    } catch (error) {
      if (handleAuthError(res, error)) return;
      next(error);
    }
  }

  router.post("/register", register);
  router.post("/signup", register);

  router.post("/verify-email", async (req, res, next) => {
    try {
      const user = await deps.auth.verifyEmail({
        email: String(req.body?.email ?? ""),
        code: String(req.body?.code ?? "")
      });
      const login = await deps.auth.createLoginSessionForUser({
        user,
        userAgent: req.headers["user-agent"]
      });
      setAuthCookie(res, login.token);
      res.json({ ok: true, data: { user: publicUser(user) } });
    } catch (error) {
      if (handleAuthError(res, error)) return;
      next(error);
    }
  });

  router.post("/resend-verification", async (req, res, next) => {
    try {
      const result = await deps.auth.resendVerificationCode({
        email: String(req.body?.email ?? "")
      });
      const payload: Record<string, unknown> = { ok: true };
      if (result.devVerificationCode) {
        payload.devVerificationCode = result.devVerificationCode;
      }
      res.json(payload);
    } catch (error) {
      if (handleAuthError(res, error)) return;
      next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const result = await deps.auth.login({
        email: String(req.body?.email ?? ""),
        password: String(req.body?.password ?? ""),
        userAgent: req.headers["user-agent"]
      });
      setAuthCookie(res, result.token);
      res.json({ ok: true, data: { user: result.user } });
    } catch (error) {
      if (handleAuthError(res, error)) return;
      next(error);
    }
  });

  router.post("/logout", requireAuth, async (req, res, next) => {
    try {
      await deps.auth.logout(req.authSession?.id);
      clearAuthCookie(res);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ ok: true, data: { user: publicUser(req.authUser!) } });
  });

  router.get("/google/status", (_req, res) => {
    res.json({ ok: true, data: { enabled: deps.auth.googleOAuthEnabled() } });
  });

  router.get("/email/status", (_req, res) => {
    res.json({ ok: true, data: deps.auth.emailDeliveryStatus() });
  });

  router.get("/google", async (req, res, next) => {
    try {
      if (!deps.auth.googleOAuthEnabled()) {
        res.status(503).json({ ok: false, error: "Google OAuth is not configured" });
        return;
      }
      const role = parseRole(req.query.role);
      if (!role) {
        res.status(400).json({ ok: false, error: "Google 가입 역할을 선택해 주세요.", code: "INVALID_ROLE" });
        return;
      }
      const state = cryptoRandomState();
      const codeVerifier = cryptoRandomState(48);
      const codeChallenge = base64UrlSha256(codeVerifier);
      const nonce = cryptoRandomState(24);
      await deps.store.createOAuthState({
        stateHash: deps.auth.tokenHash(state),
        role,
        codeVerifier,
        nonceHash: deps.auth.tokenHash(nonce),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      const params = new URLSearchParams({
        client_id: appConfig.googleOAuthClientId!,
        redirect_uri: appConfig.googleOAuthRedirectUri!,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        nonce,
        prompt: "select_account"
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    } catch (error) {
      next(error);
    }
  });

  router.get("/google/callback", async (req, res, next) => {
    try {
      if (!deps.auth.googleOAuthEnabled()) {
        res.redirect(`${appConfig.appOrigin}/login?error=google_not_configured`);
        return;
      }
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      if (!code || !state) {
        res.redirect(`${appConfig.appOrigin}/login?error=google_missing_code`);
        return;
      }
      const storedState = await deps.store.consumeOAuthState(deps.auth.tokenHash(state));
      if (!storedState) {
        res.redirect(`${appConfig.appOrigin}/login?error=google_invalid_state`);
        return;
      }

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: appConfig.googleOAuthClientId!,
          client_secret: appConfig.googleOAuthClientSecret!,
          redirect_uri: appConfig.googleOAuthRedirectUri!,
          code_verifier: storedState.codeVerifier ?? "",
          grant_type: "authorization_code"
        })
      });
      if (!tokenResponse.ok) {
        res.redirect(`${appConfig.appOrigin}/login?error=google_token_failed`);
        return;
      }
      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
        id_token?: string;
      };
      if (!tokenPayload.id_token || !tokenPayload.access_token) {
        res.redirect(`${appConfig.appOrigin}/login?error=google_token_failed`);
        return;
      }

      const tokenInfoResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenPayload.id_token)}`
      );
      if (!tokenInfoResponse.ok) {
        res.redirect(`${appConfig.appOrigin}/login?error=google_token_invalid`);
        return;
      }
      const tokenInfo = (await tokenInfoResponse.json()) as {
        aud?: string;
        iss?: string;
        exp?: string;
        sub?: string;
        email?: string;
        email_verified?: string | boolean;
      };
      const tokenPayloadClaims = decodeJwtPayload(tokenPayload.id_token) as {
        nonce?: string;
      };
      const issuerOk =
        tokenInfo.iss === "https://accounts.google.com" ||
        tokenInfo.iss === "accounts.google.com";
      const exp = Number(tokenInfo.exp ?? "0");
      const emailVerified =
        tokenInfo.email_verified === true || tokenInfo.email_verified === "true";
      const nonceOk =
        Boolean(tokenPayloadClaims.nonce) &&
        deps.auth.tokenHash(tokenPayloadClaims.nonce ?? "") === storedState.nonceHash;
      if (
        tokenInfo.aud !== appConfig.googleOAuthClientId ||
        !issuerOk ||
        !exp ||
        exp * 1000 <= Date.now() ||
        !tokenInfo.sub ||
        !tokenInfo.email ||
        !emailVerified ||
        !nonceOk
      ) {
        res.redirect(`${appConfig.appOrigin}/login?error=google_token_invalid`);
        return;
      }

      const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${tokenPayload.access_token}` }
      });
      const userInfo = userInfoResponse.ok
        ? ((await userInfoResponse.json()) as { name?: string })
        : {};
      const result = await deps.auth.loginWithGoogleProfile({
        googleSub: tokenInfo.sub,
        email: tokenInfo.email,
        emailVerified,
        displayName: userInfo.name ?? tokenInfo.email.split("@")[0],
        role: storedState.role,
        userAgent: req.headers["user-agent"]
      });
      setAuthCookie(res, result.token);
      res.redirect(`${appConfig.appOrigin}/`);
    } catch (error) {
      if (handleAuthError(res, error)) return;
      next(error);
    }
  });

  router.post(
    "/bootstrap/claim-legacy-classrooms",
    requireAuth,
    requireVerifiedEmail,
    requireTeacher,
    async (req, res, next) => {
      try {
        const claimedCount = await deps.store.claimLegacyClassroomsForTeacher(
          req.authUser!.id,
          appConfig.authBootstrapSecret,
          String(req.body?.secret ?? "")
        );
        res.json({ ok: true, data: { claimedCount } });
      } catch (error) {
        res.status(403).json({ ok: false, error: "Bootstrap secret is invalid", code: "BOOTSTRAP_FORBIDDEN" });
      }
    }
  );

  return router;
}

function cryptoRandomState(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function base64UrlSha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function decodeJwtPayload(idToken: string): Record<string, unknown> {
  try {
    const [, payload] = idToken.split(".");
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
