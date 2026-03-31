import type { Role, RolePermissions, UserRole } from "../security/rbac.js";

export type SecurityConfig = {
  /** Role-based access control configuration */
  rbac?: {
    /** Enable RBAC */
    enabled?: boolean;
    /** Role permissions mapping */
    roles?: RolePermissions;
    /** User role assignments */
    users?: UserRole[];
  };
  /** API security configuration */
  api?: {
    /** Enable API token authentication */
    tokenAuth?: boolean;
    /** Allowed origins for CORS */
    allowedOrigins?: string[];
  };
};
