import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  resendVerificationEmail as resendVerificationEmailRequest,
  signup as signupRequest,
  verifyEmail as verifyEmailRequest
} from "../api/endpoints";
import { CurrentUser, UserRole } from "../types";

type AuthStatus = "checking" | "guest" | "unverified" | "authenticated";

const pendingEmailKey = "mergeEdu.pendingVerificationEmail";

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  pendingVerificationEmail: string;
  setPendingVerificationEmail: (email: string) => void;
  clearPendingVerificationEmail: () => void;
  refreshMe: () => Promise<CurrentUser | null>;
  login: (input: { email: string; password: string }) => Promise<CurrentUser>;
  signup: (input: {
    email: string;
    password: string;
    displayName: string;
    role: UserRole;
  }) => Promise<{ user: CurrentUser; devVerificationCode?: string }>;
  resendVerificationEmail: (input: { email: string }) => Promise<{ devVerificationCode?: string }>;
  verifyEmail: (input: { email: string; code: string }) => Promise<CurrentUser>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmailState] = useState(() =>
    window.localStorage.getItem(pendingEmailKey) ?? ""
  );

  const setPendingVerificationEmail = useCallback((email: string) => {
    const normalized = email.trim();
    setPendingVerificationEmailState(normalized);
    if (normalized) {
      window.localStorage.setItem(pendingEmailKey, normalized);
      return;
    }
    window.localStorage.removeItem(pendingEmailKey);
  }, []);

  const clearPendingVerificationEmail = useCallback(() => {
    setPendingVerificationEmailState("");
    window.localStorage.removeItem(pendingEmailKey);
  }, []);

  const refreshMe = useCallback(async () => {
    const next = await getMe();
    setUser(next);
    setStatus(
      next
        ? next.emailVerified
          ? "authenticated"
          : "unverified"
        : "guest"
    );
    if (next && !next.emailVerified) {
      setPendingVerificationEmailState(next.email);
      window.localStorage.setItem(pendingEmailKey, next.email);
    }
    return next;
  }, [pendingVerificationEmail]);

  useEffect(() => {
    refreshMe().catch(() => {
      setUser(null);
      setStatus("guest");
    });
  }, [refreshMe]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      pendingVerificationEmail,
      setPendingVerificationEmail,
      clearPendingVerificationEmail,
      refreshMe,
      login: async (input) => {
        const next = await loginRequest(input);
        setUser(next);
        clearPendingVerificationEmail();
        setStatus("authenticated");
        return next;
      },
      signup: async (input) => {
        const result = await signupRequest(input);
        setPendingVerificationEmail(result.user.email);
        return result;
      },
      resendVerificationEmail: async (input) => resendVerificationEmailRequest(input),
      verifyEmail: async (input) => {
        const next = await verifyEmailRequest(input);
        setUser(next);
        clearPendingVerificationEmail();
        setStatus("authenticated");
        return next;
      },
      logout: async () => {
        try {
          await logoutRequest();
        } finally {
          setUser(null);
          clearPendingVerificationEmail();
          setStatus("guest");
        }
      }
    }),
    [
      clearPendingVerificationEmail,
      pendingVerificationEmail,
      refreshMe,
      setPendingVerificationEmail,
      status,
      user
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
