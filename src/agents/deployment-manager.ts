import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/deployment");

export interface DeploymentConfig {
  version: string;
  environment: string;
  configPath: string;
  backupPath: string;
  maxBackups: number;
  autoBackup: boolean;
  backupInterval: number; // 备份间隔（分钟）
}

export interface BackupInfo {
  id: string;
  timestamp: number;
  version: string;
  size: number;
  description?: string;
}

export class DeploymentManager {
  private config: DeploymentConfig;
  private backupInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<DeploymentConfig>) {
    this.config = {
      version: config?.version || '1.0.0',
      environment: config?.environment || 'development',
      configPath: config?.configPath || './config',
      backupPath: config?.backupPath || './backups',
      maxBackups: config?.maxBackups || 10,
      autoBackup: config?.autoBackup || true,
      backupInterval: config?.backupInterval || 60
    };

    this.initialize();
  }

  private async initialize() {
    // 创建必要的目录
    await fs.mkdir(this.config.configPath, { recursive: true });
    await fs.mkdir(this.config.backupPath, { recursive: true });

    // 启动自动备份
    if (this.config.autoBackup) {
      this.startAutoBackup();
    }
  }

  private startAutoBackup() {
    this.backupInterval = setInterval(async () => {
      try {
        await this.createBackup('Auto backup');
      } catch (error) {
        log.error('Auto backup failed', error);
      }
    }, this.config.backupInterval * 60 * 1000);
  }

  async createBackup(description?: string): Promise<BackupInfo> {
    const timestamp = Date.now();
    const backupId = `backup_${timestamp}`;
    const backupDir = path.join(this.config.backupPath, backupId);

    try {
      // 创建备份目录
      await fs.mkdir(backupDir, { recursive: true });

      // 复制配置文件
      const configFiles = await fs.readdir(this.config.configPath);
      let totalSize = 0;

      for (const file of configFiles) {
        const src = path.join(this.config.configPath, file);
        const dest = path.join(backupDir, file);
        
        const stats = await fs.stat(src);
        totalSize += stats.size;
        
        await fs.copyFile(src, dest);
      }

      // 创建备份信息文件
      const backupInfo: BackupInfo = {
        id: backupId,
        timestamp,
        version: this.config.version,
        size: totalSize,
        description
      };

      await fs.writeFile(
        path.join(backupDir, 'backup-info.json'),
        JSON.stringify(backupInfo, null, 2)
      );

      // 清理旧备份
      await this.cleanupOldBackups();

      log.info(`Created backup: ${backupId}`, backupInfo);
      return backupInfo;
    } catch (error) {
      log.error('Failed to create backup', error);
      throw error;
    }
  }

  async listBackups(): Promise<BackupInfo[]> {
    try {
      const backups: BackupInfo[] = [];
      const backupDirs = await fs.readdir(this.config.backupPath, { withFileTypes: true });

      for (const dir of backupDirs) {
        if (dir.isDirectory() && dir.name.startsWith('backup_')) {
          try {
            const infoPath = path.join(this.config.backupPath, dir.name, 'backup-info.json');
            const infoContent = await fs.readFile(infoPath, 'utf8');
            const info = JSON.parse(infoContent) as BackupInfo;
            backups.push(info);
          } catch (error) {
            log.warn(`Failed to read backup info for ${dir.name}`, error);
          }
        }
      }

      // 按时间戳排序，最新的在前
      return backups.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      log.error('Failed to list backups', error);
      return [];
    }
  }

  async restoreBackup(backupId: string): Promise<boolean> {
    try {
      const backupDir = path.join(this.config.backupPath, backupId);
      const infoPath = path.join(backupDir, 'backup-info.json');

      // 验证备份存在
      await fs.access(infoPath);

      // 读取备份信息
      const infoContent = await fs.readFile(infoPath, 'utf8');
      const info = JSON.parse(infoContent) as BackupInfo;

      // 备份当前配置
      await this.createBackup(`Pre-restore backup before ${backupId}`);

      // 恢复配置文件
      const backupFiles = await fs.readdir(backupDir);
      for (const file of backupFiles) {
        if (file === 'backup-info.json') continue;
        
        const src = path.join(backupDir, file);
        const dest = path.join(this.config.configPath, file);
        
        await fs.copyFile(src, dest);
      }

      log.info(`Restored backup: ${backupId}`, info);
      return true;
    } catch (error) {
      log.error(`Failed to restore backup ${backupId}`, error);
      return false;
    }
  }

  private async cleanupOldBackups() {
    try {
      const backups = await this.listBackups();
      if (backups.length <= this.config.maxBackups) {
        return;
      }

      // 删除最旧的备份
      const backupsToDelete = backups.slice(this.config.maxBackups);
      for (const backup of backupsToDelete) {
        const backupDir = path.join(this.config.backupPath, backup.id);
        await fs.rm(backupDir, { recursive: true, force: true });
        log.info(`Cleaned up old backup: ${backup.id}`);
      }
    } catch (error) {
      log.error('Failed to cleanup old backups', error);
    }
  }

  async getConfigVersion(): Promise<string> {
    try {
      const versionPath = path.join(this.config.configPath, 'version.json');
      const content = await fs.readFile(versionPath, 'utf8');
      const versionInfo = JSON.parse(content);
      return versionInfo.version || this.config.version;
    } catch (error) {
      return this.config.version;
    }
  }

  async updateConfigVersion(version: string): Promise<void> {
    try {
      const versionPath = path.join(this.config.configPath, 'version.json');
      await fs.writeFile(
        versionPath,
        JSON.stringify({ version, updatedAt: Date.now() }, null, 2)
      );
      this.config.version = version;
      log.info(`Updated config version to: ${version}`);
    } catch (error) {
      log.error('Failed to update config version', error);
    }
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    try {
      const errors: string[] = [];
      const configFiles = await fs.readdir(this.config.configPath);

      // 检查必要的配置文件
      const requiredFiles = ['config.json', 'version.json'];
      for (const file of requiredFiles) {
        const filePath = path.join(this.config.configPath, file);
        try {
          await fs.access(filePath);
        } catch {
          errors.push(`Missing required config file: ${file}`);
        }
      }

      // 验证配置文件格式
      for (const file of configFiles) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.config.configPath, file);
            const content = await fs.readFile(filePath, 'utf8');
            JSON.parse(content);
          } catch (error) {
            errors.push(`Invalid JSON in ${file}: ${(error as Error).message}`);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation failed: ${(error as Error).message}`]
      };
    }
  }

  getDeploymentInfo(): any {
    return {
      version: this.config.version,
      environment: this.config.environment,
      configPath: this.config.configPath,
      backupPath: this.config.backupPath,
      autoBackup: this.config.autoBackup,
      backupInterval: this.config.backupInterval,
      maxBackups: this.config.maxBackups
    };
  }

  shutdown() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
    log.info('Deployment manager shutdown');
  }
}

// 全局部署管理器实例
let globalDeploymentManager: DeploymentManager | null = null;

export function getDeploymentManager(config?: Partial<DeploymentConfig>): DeploymentManager {
  if (!globalDeploymentManager) {
    globalDeploymentManager = new DeploymentManager(config);
  }
  return globalDeploymentManager;
}

export function shutdownDeploymentManager() {
  if (globalDeploymentManager) {
    globalDeploymentManager.shutdown();
    globalDeploymentManager = null;
  }
}
