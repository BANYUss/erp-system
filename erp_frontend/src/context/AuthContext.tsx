"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import api, {
  AUTH_UNAUTHORIZED_EVENT,
  clearAuthToken,
  getAuthToken,
  setAuthToken,
} from "@/lib/api";
import type {
  AuthContextValue,
  AuthUser,
  LoginApiResponse,
  LoginCredentials,
  MeApiResponse,
} from "@/types/auth";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const response = await api.get<MeApiResponse>("/auth/me");
      const fetchedUser = response.data.data;
      setUser(fetchedUser);
      return fetchedUser;
    } catch {
      clearAuthToken();
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const bootstrapAuth = async () => {
      const token = getAuthToken();
      if (!token) {
        await Promise.resolve();
        if (isMounted) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const response = await api.get<MeApiResponse>("/auth/me");
        if (isMounted) {
          setUser(response.data.data);
        }
      } catch {
        clearAuthToken();
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void bootstrapAuth();

    const handleUnauthorized = () => {
      if (isMounted) {
        setUser(null);
        setIsLoading(false);
      }
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);

    return () => {
      isMounted = false;
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, []);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<AuthUser> => {
      const payload: LoginCredentials = {
        email: credentials.email.trim(),
        password: credentials.password,
        device_name: credentials.device_name ?? "erp-web-client",
      };

      const response = await api.post<LoginApiResponse>("/auth/login", payload);
      const { access_token: accessToken, user: authenticatedUser } =
        response.data.data;

      setAuthToken(accessToken);
      setUser(authenticatedUser);

      return authenticatedUser;
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      if (getAuthToken()) {
        await api.post("/auth/logout");
      }
    } catch {
      // Tetap lanjutkan pembersihan sesi lokal meski token sudah kedaluwarsa
    } finally {
      clearAuthToken();
      setUser(null);
      router.replace("/login");
    }
  }, [router]);

  const roles = useMemo(() => user?.roles ?? [], [user]);
  const permissions = useMemo(() => user?.permissions ?? [], [user]);

  const hasRole = useCallback(
    (role: string | string[]): boolean => {
      if (roles.length === 0) {
        return false;
      }
      const targetRoles = Array.isArray(role) ? role : [role];
      return targetRoles.some((r) => roles.includes(r));
    },
    [roles]
  );

  const hasPermission = useCallback(
    (permission: string | string[], requireAll = false): boolean => {
      if (!user) {
        return false;
      }

      // Sesuai architecture.md: Super Admin memiliki akses penuh / bypass
      if (roles.includes("Super Admin")) {
        return true;
      }

      const targetPermissions = Array.isArray(permission)
        ? permission
        : [permission];

      if (targetPermissions.length === 0) {
        return true;
      }

      if (requireAll) {
        return targetPermissions.every((perm) => permissions.includes(perm));
      }

      return targetPermissions.some((perm) => permissions.includes(perm));
    },
    [user, roles, permissions]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      roles,
      permissions,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      logout,
      refreshUser,
      hasRole,
      hasPermission,
    }),
    [
      user,
      roles,
      permissions,
      isLoading,
      login,
      logout,
      refreshUser,
      hasRole,
      hasPermission,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth harus digunakan di dalam AuthProvider.");
  }
  return context;
}
