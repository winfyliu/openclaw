import type { OpenClawConfig } from "../config/config.js";

export type Role = "admin" | "user" | "guest" | string;

export type Permission = 
  | "gateway:start"
  | "gateway:stop"
  | "models:auth"
  | "models:list"
  | "channels:manage"
  | "plugins:install"
  | "plugins:uninstall"
  | "plugins:enable"
  | "plugins:disable"
  | "commands:execute"
  | "tools:use"
  | string;

export type RolePermissions = {
  [role in Role]: Permission[];
};

export type UserRole = {
  userId: string;
  role: Role;
  channel?: string;
};

export class RBACManager {
  private rolePermissions: RolePermissions;
  private userRoles: Map<string, UserRole[]>;
  private config: OpenClawConfig;

  constructor(config: OpenClawConfig) {
    this.config = config;
    this.rolePermissions = this.loadRolePermissions();
    this.userRoles = this.loadUserRoles();
  }

  private loadRolePermissions(): RolePermissions {
    // 从配置中加载角色权限
    const configRoles = this.config.security?.rbac?.roles;
    if (configRoles) {
      return configRoles;
    }

    // 默认角色权限
    return {
      admin: [
        "gateway:start",
        "gateway:stop",
        "models:auth",
        "models:list",
        "channels:manage",
        "plugins:install",
        "plugins:uninstall",
        "plugins:enable",
        "plugins:disable",
        "commands:execute",
        "tools:use"
      ],
      user: [
        "models:list",
        "commands:execute",
        "tools:use"
      ],
      guest: [
        "commands:execute"
      ]
    };
  }

  private loadUserRoles(): Map<string, UserRole[]> {
    const configUsers = this.config.security?.rbac?.users || [];
    const userRoles = new Map<string, UserRole[]>();

    configUsers.forEach(user => {
      if (!userRoles.has(user.userId)) {
        userRoles.set(user.userId, []);
      }
      userRoles.get(user.userId)?.push(user);
    });

    return userRoles;
  }

  /**
   * 检查用户是否有权限执行特定操作
   */
  hasPermission(userId: string, permission: Permission, channel?: string): boolean {
    const userRoles = this.getUserRoles(userId, channel);
    
    for (const role of userRoles) {
      const permissions = this.rolePermissions[role];
      if (permissions && permissions.includes(permission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取用户的角色列表
   */
  getUserRoles(userId: string, channel?: string): Role[] {
    const userRoles = this.userRoles.get(userId) || [];
    const roles: Role[] = [];

    userRoles.forEach(userRole => {
      if (!channel || !userRole.channel || userRole.channel === channel) {
        roles.push(userRole.role);
      }
    });

    // 如果没有指定角色，返回默认角色
    if (roles.length === 0) {
      return ["guest"];
    }

    return roles;
  }

  /**
   * 为用户添加角色
   */
  addUserRole(userRole: UserRole): void {
    if (!this.userRoles.has(userRole.userId)) {
      this.userRoles.set(userRole.userId, []);
    }

    const existingRoles = this.userRoles.get(userRole.userId) || [];
    const roleExists = existingRoles.some(r => 
      r.role === userRole.role && r.channel === userRole.channel
    );

    if (!roleExists) {
      existingRoles.push(userRole);
      this.userRoles.set(userRole.userId, existingRoles);
    }
  }

  /**
   * 移除用户的角色
   */
  removeUserRole(userId: string, role: Role, channel?: string): void {
    const userRoles = this.userRoles.get(userId);
    if (!userRoles) {
      return;
    }

    const filteredRoles = userRoles.filter(r => 
      !(r.role === role && r.channel === channel)
    );

    if (filteredRoles.length === 0) {
      this.userRoles.delete(userId);
    } else {
      this.userRoles.set(userId, filteredRoles);
    }
  }

  /**
   * 检查用户是否具有特定角色
   */
  hasRole(userId: string, role: Role, channel?: string): boolean {
    const userRoles = this.getUserRoles(userId, channel);
    return userRoles.includes(role);
  }

  /**
   * 获取角色的权限列表
   */
  getRolePermissions(role: Role): Permission[] {
    return this.rolePermissions[role] || [];
  }

  /**
   * 添加角色权限
   */
  addRolePermission(role: Role, permission: Permission): void {
    if (!this.rolePermissions[role]) {
      this.rolePermissions[role] = [];
    }

    if (!this.rolePermissions[role].includes(permission)) {
      this.rolePermissions[role].push(permission);
    }
  }

  /**
   * 移除角色权限
   */
  removeRolePermission(role: Role, permission: Permission): void {
    if (!this.rolePermissions[role]) {
      return;
    }

    this.rolePermissions[role] = this.rolePermissions[role].filter(p => p !== permission);
  }

  /**
   * 列出所有用户及其角色
   */
  listUsers(): UserRole[] {
    const users: UserRole[] = [];
    this.userRoles.forEach(roles => {
      users.push(...roles);
    });
    return users;
  }

  /**
   * 列出所有角色
   */
  listRoles(): Role[] {
    return Object.keys(this.rolePermissions) as Role[];
  }
}

/**
 * 创建 RBAC 管理器实例
 */
export function createRBACManager(config: OpenClawConfig): RBACManager {
  return new RBACManager(config);
}
