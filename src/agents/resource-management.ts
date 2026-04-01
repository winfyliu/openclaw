import os from "node:os";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/resource-management");

export interface ResourceLimits {
  cpu: {
    maxUsage: number; // 最大CPU使用率（百分比）
    maxThreads: number; // 最大线程数
  };
  memory: {
    maxUsage: number; // 最大内存使用率（百分比）
    maxHeapSize: number; // 最大堆大小（MB）
  };
  network: {
    maxConcurrentRequests: number; // 最大并发请求数
    maxBandwidth: number; // 最大带宽（KB/s）
  };
  disk: {
    maxUsage: number; // 最大磁盘使用率（百分比）
    maxTempFiles: number; // 最大临时文件数
  };
}

export interface ResourceUsage {
  cpu: {
    usage: number; // 当前CPU使用率（百分比）
    threads: number; // 当前线程数
  };
  memory: {
    usage: number; // 当前内存使用率（百分比）
    heapSize: number; // 当前堆大小（MB）
  };
  network: {
    concurrentRequests: number; // 当前并发请求数
    bandwidth: number; // 当前带宽（KB/s）
  };
  disk: {
    usage: number; // 当前磁盘使用率（百分比）
    tempFiles: number; // 当前临时文件数
  };
}

export class ResourceManager {
  private limits: ResourceLimits;
  private usage: ResourceUsage;
  private requestCount: number = 0;
  private tempFiles: Set<string> = new Set();

  constructor(limits?: Partial<ResourceLimits>) {
    this.limits = {
      cpu: {
        maxUsage: limits?.cpu?.maxUsage || 80,
        maxThreads: limits?.cpu?.maxThreads || os.cpus().length
      },
      memory: {
        maxUsage: limits?.memory?.maxUsage || 80,
        maxHeapSize: limits?.memory?.maxHeapSize || 1024
      },
      network: {
        maxConcurrentRequests: limits?.network?.maxConcurrentRequests || 100,
        maxBandwidth: limits?.network?.maxBandwidth || 10240
      },
      disk: {
        maxUsage: limits?.disk?.maxUsage || 90,
        maxTempFiles: limits?.disk?.maxTempFiles || 1000
      }
    };

    this.usage = {
      cpu: { usage: 0, threads: 0 },
      memory: { usage: 0, heapSize: 0 },
      network: { concurrentRequests: 0, bandwidth: 0 },
      disk: { usage: 0, tempFiles: 0 }
    };

    // 定期更新资源使用情况
    setInterval(() => this.updateResourceUsage(), 5000);
  }

  private updateResourceUsage() {
    // CPU使用率
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    this.usage.cpu.usage = cpuUsage;
    this.usage.cpu.threads = os.cpus().length;

    // 内存使用率
    const memory = process.memoryUsage();
    const totalMemory = os.totalmem();
    const memoryUsage = (memory.rss / totalMemory) * 100;
    this.usage.memory.usage = memoryUsage;
    this.usage.memory.heapSize = memory.heapUsed / 1024 / 1024;

    // 网络使用率（简化版）
    this.usage.network.concurrentRequests = this.requestCount;
    this.usage.network.bandwidth = 0; // 需要实现

    // 磁盘使用率（简化版）
    this.usage.disk.usage = 0; // 需要实现
    this.usage.disk.tempFiles = this.tempFiles.size;
  }

  checkResourceAvailability(): boolean {
    this.updateResourceUsage();

    const cpuOk = this.usage.cpu.usage < this.limits.cpu.maxUsage;
    const memoryOk = this.usage.memory.usage < this.limits.memory.maxUsage;
    const networkOk = this.usage.network.concurrentRequests < this.limits.network.maxConcurrentRequests;
    const diskOk = this.usage.disk.usage < this.limits.disk.maxUsage;

    return cpuOk && memoryOk && networkOk && diskOk;
  }

  async withResourceLimit<T>(operation: () => Promise<T>, resourceType: 'cpu' | 'memory' | 'network' | 'disk'): Promise<T> {
    switch (resourceType) {
      case 'network':
        this.requestCount++;
        try {
          return await operation();
        } finally {
          this.requestCount--;
        }
      default:
        return await operation();
    }
  }

  registerTempFile(filePath: string) {
    if (this.tempFiles.size < this.limits.disk.maxTempFiles) {
      this.tempFiles.add(filePath);
    } else {
      log.warn('Temp file limit reached, cannot register more temp files');
    }
  }

  unregisterTempFile(filePath: string) {
    this.tempFiles.delete(filePath);
  }

  cleanupTempFiles() {
    for (const filePath of this.tempFiles) {
      try {
        // 这里应该删除文件
        this.tempFiles.delete(filePath);
      } catch (error) {
        log.warn(`Failed to cleanup temp file: ${filePath}`, error);
      }
    }
  }

  getResourceUsage(): ResourceUsage {
    this.updateResourceUsage();
    return { ...this.usage };
  }

  getResourceLimits(): ResourceLimits {
    return { ...this.limits };
  }

  setResourceLimits(limits: Partial<ResourceLimits>) {
    this.limits = {
      cpu: { ...this.limits.cpu, ...limits.cpu },
      memory: { ...this.limits.memory, ...limits.memory },
      network: { ...this.limits.network, ...limits.network },
      disk: { ...this.limits.disk, ...limits.disk }
    };
  }

  isResourceOverloaded(): boolean {
    this.updateResourceUsage();

    return (
      this.usage.cpu.usage >= this.limits.cpu.maxUsage ||
      this.usage.memory.usage >= this.limits.memory.maxUsage ||
      this.usage.network.concurrentRequests >= this.limits.network.maxConcurrentRequests ||
      this.usage.disk.usage >= this.limits.disk.maxUsage
    );
  }

  getResourceRecommendations(): string[] {
    const recommendations: string[] = [];

    if (this.usage.cpu.usage >= this.limits.cpu.maxUsage) {
      recommendations.push('CPU usage is high, consider reducing concurrent tasks');
    }

    if (this.usage.memory.usage >= this.limits.memory.maxUsage) {
      recommendations.push('Memory usage is high, consider increasing memory or reducing task complexity');
    }

    if (this.usage.network.concurrentRequests >= this.limits.network.maxConcurrentRequests) {
      recommendations.push('Network requests are high, consider implementing request throttling');
    }

    if (this.usage.disk.usage >= this.limits.disk.maxUsage) {
      recommendations.push('Disk usage is high, consider cleaning up temporary files');
    }

    if (this.tempFiles.size >= this.limits.disk.maxTempFiles) {
      recommendations.push('Too many temporary files, consider cleaning up');
    }

    return recommendations;
  }
}

// 全局资源管理器实例
let globalResourceManager: ResourceManager | null = null;

export function getResourceManager(): ResourceManager {
  if (!globalResourceManager) {
    globalResourceManager = new ResourceManager();
  }
  return globalResourceManager;
}

export function shutdownResourceManager() {
  if (globalResourceManager) {
    globalResourceManager.cleanupTempFiles();
    globalResourceManager = null;
  }
}
