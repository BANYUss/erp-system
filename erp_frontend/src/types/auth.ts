export type RoleName =
  | "Super Admin"
  | "Staf Gudang"
  | "Admin Sales"
  | "Purchasing"
  | "Finance"
  | "Manajer"
  | (string & {});

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
  roles: RoleName[];
  permissions: string[];
}

export interface LoginCredentials {
  email: string;
  password: string;
  device_name?: string;
}

export interface LoginApiResponse {
  message: string;
  data: {
    token_type: string;
    access_token: string;
    user: AuthUser;
  };
}

export interface MeApiResponse {
  data: AuthUser;
}

export interface LogoutApiResponse {
  message: string;
}

export interface ApiErrorResponse {
  message?: string;
  errors?: Record<string, string[]>;
}

export interface AuthContextValue {
  user: AuthUser | null;
  roles: RoleName[];
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  hasRole: (role: string | string[]) => boolean;
  hasPermission: (permission: string | string[], requireAll?: boolean) => boolean;
}
