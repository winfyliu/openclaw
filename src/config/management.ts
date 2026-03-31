import fs from "node:fs/promises";
import path from "node:path";
import { validateConfigObjectWithPlugins } from "./validation.js";
import type { OpenClawConfig, ConfigValidationIssue } from "./types.js";
import { OpenClawSchema } from "./zod-schema.js";

export type ConfigVersion = {
  version: string;
  timestamp: number;
  hash: string;
};

export type ConfigHealthStatus = {
  valid: boolean;
  issues: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
  lastChecked: number;
  version: string;
};

export type ConfigChangeEvent = {
  type: "create" | "update" | "delete";
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
  timestamp: number;
};

export class ConfigManager {
  private configPath: string;
  private config: OpenClawConfig | null = null;
  private versionHistory: ConfigVersion[] = [];
  private changeEvents: ConfigChangeEvent[] = [];
  private healthStatus: ConfigHealthStatus | null = null;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  /**
   * 加载配置文件
   */
  async load(): Promise<{ ok: boolean; config?: OpenClawConfig; error?: string }> {
    try {
      const content = await fs.readFile(this.configPath, "utf8");
      const parsed = JSON.parse(content);
      
      const validation = validateConfigObjectWithPlugins(parsed);
      if (!validation.ok) {
        return {
          ok: false,
          error: validation.issues.map(i => `${i.path}: ${i.message}`).join("\n")
        };
      }

      this.config = validation.config;
      this.updateHealthStatus([], validation.warnings);
      this.addVersionHistory(validation.config);
      
      return {
        ok: true,
        config: validation.config
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * 保存配置文件
   */
  async save(config: OpenClawConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const validation = validateConfigObjectWithPlugins(config);
      if (!validation.ok) {
        return {
          ok: false,
          error: validation.issues.map(i => `${i.path}: ${i.message}`).join("\n")
        };
      }

      // 确保配置目录存在
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      // 保存配置文件
      const content = JSON.stringify(config, null, 2);
      await fs.writeFile(this.configPath, content);

      // 更新内部状态
      this.config = config;
      this.updateHealthStatus([], validation.warnings);
      this.addVersionHistory(config);
      
      // 触发配置变更事件
      this.changeEvents.push({
        type: "update",
        path: this.configPath,
        oldValue: this.config,
        newValue: config,
        timestamp: Date.now()
      });

      return {
        ok: true
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): OpenClawConfig | null {
    return this.config;
  }

  /**
   * 验证配置
   */
  validate(): { ok: boolean; issues: ConfigValidationIssue[]; warnings: ConfigValidationIssue[] } {
    if (!this.config) {
      return {
        ok: false,
        issues: [{ path: "config", message: "Config not loaded" }],
        warnings: []
      };
    }

    const validation = validateConfigObjectWithPlugins(this.config);
    this.updateHealthStatus(validation.ok ? [] : validation.issues, validation.warnings);

    return {
      ok: validation.ok,
      issues: validation.ok ? [] : validation.issues,
      warnings: validation.warnings
    };
  }

  /**
   * 获取配置健康状态
   */
  getHealthStatus(): ConfigHealthStatus | null {
    return this.healthStatus;
  }

  /**
   * 获取配置版本历史
   */
  getVersionHistory(): ConfigVersion[] {
    return this.versionHistory;
  }

  /**
   * 获取配置变更事件
   */
  getChangeEvents(): ConfigChangeEvent[] {
    return this.changeEvents;
  }

  /**
   * 生成配置文档
   */
  generateDocumentation(): string {
    const schema = OpenClawSchema;
    return this.generateSchemaDocumentation(schema, "OpenClaw Configuration");
  }

  /**
   * 监控配置文件变化
   */
  async monitorChanges(callback: (event: ConfigChangeEvent) => void): Promise<() => void> {
    // 这里可以实现文件系统监控
    // 简化版本，返回一个空函数
    return () => {};
  }

  /**
   * 应用配置迁移
   */
  migrateConfig(config: OpenClawConfig): OpenClawConfig {
    // 实现配置迁移逻辑
    return config;
  }

  /**
   * 导出配置
   */
  async exportConfig(format: "json" | "yaml" = "json"): Promise<string> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    if (format === "json") {
      return JSON.stringify(this.config, null, 2);
    } else {
      // 实现 YAML 导出
      return JSON.stringify(this.config, null, 2);
    }
  }

  /**
   * 导入配置
   */
  async importConfig(content: string, format: "json" | "yaml" = "json"): Promise<{ ok: boolean; error?: string }> {
    try {
      let parsed: unknown;
      if (format === "json") {
        parsed = JSON.parse(content);
      } else {
        // 实现 YAML 导入
        parsed = JSON.parse(content);
      }

      const validation = validateConfigObjectWithPlugins(parsed);
      if (!validation.ok) {
        return {
          ok: false,
          error: validation.issues.map(i => `${i.path}: ${i.message}`).join("\n")
        };
      }

      return await this.save(validation.config);
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message
      };
    }
  }

  private updateHealthStatus(issues: ConfigValidationIssue[], warnings: ConfigValidationIssue[]) {
    this.healthStatus = {
      valid: issues.length === 0,
      issues,
      warnings,
      lastChecked: Date.now(),
      version: this.config?.meta?.lastTouchedVersion || "unknown"
    };
  }

  private addVersionHistory(config: OpenClawConfig) {
    const version: ConfigVersion = {
      version: config.meta?.lastTouchedVersion || "unknown",
      timestamp: Date.now(),
      hash: this.generateConfigHash(config)
    };

    this.versionHistory.push(version);
    // 只保留最近 10 个版本
    if (this.versionHistory.length > 10) {
      this.versionHistory = this.versionHistory.slice(-10);
    }
  }

  private generateConfigHash(config: OpenClawConfig): string {
    const content = JSON.stringify(config);
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private generateSchemaDocumentation(schema: any, title: string): string {
    // 简化版文档生成
    return `# ${title}\n\nThis is the configuration schema for OpenClaw.`;
  }
}

/**
 * 创建配置管理器实例
 */
export function createConfigManager(configPath: string): ConfigManager {
  return new ConfigManager(configPath);
}
