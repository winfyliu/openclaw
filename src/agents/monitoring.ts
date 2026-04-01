import os from "node:os";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getSubAgentPool } from "./subagent-pool.js";
import { getTaskManager } from "./task-manager.js";
import { getErrorHandler } from "./error-handling.js";

const log = createSubsystemLogger("agents/monitoring");

export interface Metric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'timer';
  tags?: Record<string, string>;
  timestamp: number;
}

export interface TaskMetrics {
  activeTasks: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageTaskTime: number;
}

export interface AgentMetrics {
  activeAgents: number;
  totalAgents: number;
  idleAgents: number;
  averageAgentAge: number;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkUsage: number;
}

export interface MonitoringStats {
  taskMetrics: TaskMetrics;
  agentMetrics: AgentMetrics;
  systemMetrics: SystemMetrics;
  errorMetrics: any;
  timestamp: number;
}

export class MonitoringManager {
  private metrics: Metric[] = [];
  private maxMetrics: number = 10000;
  private taskStats: {
    completed: number;
    failed: number;
    totalTime: number;
    taskCount: number;
  } = {
    completed: 0,
    failed: 0,
    totalTime: 0,
    taskCount: 0
  };

  recordMetric(name: string, value: number, type: 'counter' | 'gauge' | 'timer', tags?: Record<string, string>) {
    const metric: Metric = {
      name,
      value,
      type,
      tags,
      timestamp: Date.now()
    };

    this.metrics.push(metric);

    // 保持指标数量在合理范围内
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  recordTaskCompletion(taskId: string, duration: number, success: boolean) {
    this.recordMetric('task.duration', duration, 'timer', { taskId, success: success.toString() });
    
    if (success) {
      this.recordMetric('task.completed', 1, 'counter');
      this.taskStats.completed++;
    } else {
      this.recordMetric('task.failed', 1, 'counter');
      this.taskStats.failed++;
    }
    
    this.taskStats.totalTime += duration;
    this.taskStats.taskCount++;
  }

  recordAgentActivity(agentId: string, activity: 'start' | 'end' | 'idle' | 'active') {
    this.recordMetric('agent.activity', 1, 'counter', { agentId, activity });
  }

  getTaskMetrics(): TaskMetrics {
    const taskManager = getTaskManager();
    
    return {
      activeTasks: taskManager.getActiveTaskCount(),
      queuedTasks: taskManager.getQueueLength(),
      completedTasks: this.taskStats.completed,
      failedTasks: this.taskStats.failed,
      averageTaskTime: this.taskStats.taskCount > 0 ? this.taskStats.totalTime / this.taskStats.taskCount : 0
    };
  }

  getAgentMetrics(): AgentMetrics {
    const subAgentPool = getSubAgentPool();
    const totalAgents = subAgentPool.getPoolSize();
    const activeAgents = subAgentPool.getActiveAgents();
    
    return {
      activeAgents,
      totalAgents,
      idleAgents: totalAgents - activeAgents,
      averageAgentAge: 0 // 暂时返回0，需要实现
    };
  }

  getSystemMetrics(): SystemMetrics {
    // CPU 使用率
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    
    // 内存使用率
    const memory = process.memoryUsage();
    const memoryUsage = (memory.rss / (os.totalmem() * 1024)) * 100;
    
    // 磁盘使用率（简化版）
    const diskUsage = 0; // 需要实现
    
    // 网络使用率（简化版）
    const networkUsage = 0; // 需要实现
    
    return {
      cpuUsage,
      memoryUsage,
      diskUsage,
      networkUsage
    };
  }

  getErrorMetrics(sessionId?: string) {
    const errorHandler = getErrorHandler();
    return errorHandler.getErrorStats(sessionId);
  }

  getStats(): MonitoringStats {
    return {
      taskMetrics: this.getTaskMetrics(),
      agentMetrics: this.getAgentMetrics(),
      systemMetrics: this.getSystemMetrics(),
      errorMetrics: this.getErrorMetrics(),
      timestamp: Date.now()
    };
  }

  getMetricsByName(name: string): Metric[] {
    return this.metrics.filter(metric => metric.name === name);
  }

  getMetricsByTag(tag: string, value: string): Metric[] {
    return this.metrics.filter(metric => metric.tags?.[tag] === value);
  }

  clearMetrics() {
    this.metrics = [];
    this.taskStats = {
      completed: 0,
      failed: 0,
      totalTime: 0,
      taskCount: 0
    };
  }

  exportMetrics(): Metric[] {
    return [...this.metrics];
  }
}

// 全局监控管理器实例
let globalMonitoringManager: MonitoringManager | null = null;

export function getMonitoringManager(): MonitoringManager {
  if (!globalMonitoringManager) {
    globalMonitoringManager = new MonitoringManager();
  }
  return globalMonitoringManager;
}

export function shutdownMonitoringManager() {
  if (globalMonitoringManager) {
    globalMonitoringManager.clearMetrics();
    globalMonitoringManager = null;
  }
}
