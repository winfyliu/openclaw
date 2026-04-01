import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/security");

export interface InputValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: any;
}

export interface Permission {
  name: string;
  description: string;
}

export interface Role {
  name: string;
  permissions: string[];
  description: string;
}

export interface User {
  id: string;
  roles: string[];
  permissions: string[];
}

export class SecurityManager {
  private roles: Map<string, Role> = new Map();
  private users: Map<string, User> = new Map();
  private rateLimits: Map<string, {
    count: number;
    lastReset: number;
  }> = new Map();

  constructor() {
    this.initializeDefaultRoles();
  }

  private initializeDefaultRoles() {
    // 初始化默认角色
    this.roles.set('admin', {
      name: 'admin',
      permissions: ['all'],
      description: 'Administrator with all permissions'
    });

    this.roles.set('user', {
      name: 'user',
      permissions: ['task:create', 'task:view', 'agent:use'],
      description: 'Regular user with basic permissions'
    });

    this.roles.set('guest', {
      name: 'guest',
      permissions: ['task:view'],
      description: 'Guest with limited permissions'
    });
  }

  validateInput(input: any, schema: any): InputValidationResult {
    const errors: string[] = [];
    const sanitized: any = {};

    try {
      // 简单的输入验证
      if (typeof input !== 'object' || input === null) {
        return {
          valid: false,
          errors: ['Input must be an object']
        };
      }

      // 验证必填字段
      if (schema.required) {
        for (const field of schema.required) {
          if (input[field] === undefined || input[field] === null) {
            errors.push(`Field ${field} is required`);
          } else {
            sanitized[field] = this.sanitizeValue(input[field], schema.fields?.[field]);
          }
        }
      }

      // 验证可选字段
      if (schema.fields) {
        for (const [field, fieldSchema] of Object.entries(schema.fields)) {
          if (input[field] !== undefined) {
            sanitized[field] = this.sanitizeValue(input[field], fieldSchema);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        sanitized
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation error: ${(error as Error).message}`]
      };
    }
  }

  private sanitizeValue(value: any, schema?: any): any {
    if (typeof value === 'string') {
      // 清理字符串
      return value
        .replace(/[<>"'&]/g, '')
        .trim()
        .substring(0, 1000); // 限制长度
    }
    if (typeof value === 'number') {
      // 确保是有效数字
      return isNaN(value) ? 0 : value;
    }
    if (Array.isArray(value)) {
      // 限制数组长度
      return value.slice(0, 100).map(item => this.sanitizeValue(item));
    }
    if (typeof value === 'object' && value !== null) {
      // 清理对象
      const sanitized: any = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = this.sanitizeValue(val);
      }
      return sanitized;
    }
    return value;
  }

  checkPermission(userId: string, permission: string): boolean {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    // 检查用户直接拥有的权限
    if (user.permissions.includes(permission) || user.permissions.includes('all')) {
      return true;
    }

    // 检查用户角色的权限
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (role && (role.permissions.includes(permission) || role.permissions.includes('all'))) {
        return true;
      }
    }

    return false;
  }

  addUser(user: User) {
    this.users.set(user.id, user);
  }

  addRole(role: Role) {
    this.roles.set(role.name, role);
  }

  checkRateLimit(userId: string, limit: number = 60, windowMs: number = 60000): boolean {
    const now = Date.now();
    const userLimit = this.rateLimits.get(userId);

    if (!userLimit) {
      this.rateLimits.set(userId, {
        count: 1,
        lastReset: now
      });
      return true;
    }

    // 检查是否需要重置计数器
    if (now - userLimit.lastReset > windowMs) {
      this.rateLimits.set(userId, {
        count: 1,
        lastReset: now
      });
      return true;
    }

    // 检查是否超过限制
    if (userLimit.count >= limit) {
      return false;
    }

    // 增加计数
    this.rateLimits.set(userId, {
      count: userLimit.count + 1,
      lastReset: userLimit.lastReset
    });

    return true;
  }

  sanitizeTaskInput(task: string): string {
    // 清理任务输入
    return task
      .replace(/[<>"'&]/g, '')
      .trim()
      .substring(0, 5000); // 限制任务长度
  }

  validateAgentId(agentId: string): boolean {
    // 验证Agent ID格式
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId);
  }

  validateSessionKey(sessionKey: string): boolean {
    // 验证会话密钥格式
    return /^agent:[a-z0-9_-]+:[a-z0-9_-]+$/.test(sessionKey);
  }

  getSecurityRecommendations(): string[] {
    const recommendations: string[] = [];

    // 检查用户数量
    if (this.users.size === 0) {
      recommendations.push('No users defined, consider adding at least one admin user');
    }

    // 检查角色配置
    if (this.roles.size < 2) {
      recommendations.push('Limited role configuration, consider adding more roles for better access control');
    }

    // 检查速率限制
    const rateLimitUsers = Array.from(this.rateLimits.entries())
      .filter(([_, limit]) => limit.count > 50)
      .length;
    if (rateLimitUsers > 0) {
      recommendations.push(`${rateLimitUsers} users are approaching rate limits`);
    }

    return recommendations;
  }
}

// 全局安全管理器实例
let globalSecurityManager: SecurityManager | null = null;

export function getSecurityManager(): SecurityManager {
  if (!globalSecurityManager) {
    globalSecurityManager = new SecurityManager();
  }
  return globalSecurityManager;
}

export function shutdownSecurityManager() {
  globalSecurityManager = null;
}
