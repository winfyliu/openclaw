import { getSubAgentPool } from "./subagent-pool.js";
import { getTaskContextManager } from "./task-context-manager.js";
import type { SpawnSubagentParams, SpawnSubagentContext } from "./subagent-spawn.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/task-manager");

export interface TaskMessage {
  content: string;
  userId: string;
  channel: string;
  sessionId: string;
  timestamp: number;
}

export interface TaskAssignment {
  taskId: string;
  status: 'processing' | 'queued';
  message: string;
}

export class TaskManager {
  private subAgentPool = getSubAgentPool();
  private taskContextManager = getTaskContextManager();
  private maxConcurrentTasks: number;
  private activeTasks: Set<string> = new Set();
  private taskQueue: Array<{ taskId: string; message: TaskMessage; task: string }> = [];

  constructor(maxConcurrentTasks: number = 3) {
    this.maxConcurrentTasks = maxConcurrentTasks;
  }

  async assignTask(message: TaskMessage, task: string): Promise<TaskAssignment> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (this.activeTasks.size >= this.maxConcurrentTasks) {
      this.taskQueue.push({ taskId, message, task });
      log.debug(`Task ${taskId} queued, active tasks: ${this.activeTasks.size}/${this.maxConcurrentTasks}`);
      return {
        taskId,
        status: 'queued',
        message: '我现在有点忙，等我手头的事情做完了就帮你处理这个请求'
      };
    }
    
    this.activeTasks.add(taskId);
    this.processTask(taskId, message, task);
    
    log.debug(`Task ${taskId} assigned, active tasks: ${this.activeTasks.size}/${this.maxConcurrentTasks}`);
    return {
      taskId,
      status: 'processing',
      message: this.generateAssignmentMessage(task)
    };
  }

  private async processTask(taskId: string, message: TaskMessage, task: string) {
    const taskContext = this.taskContextManager.createTaskContext(
      message.sessionId,
      taskId,
      message
    );
    
    let contextId: string | undefined;
    if (taskContext.relatedTasks.length > 0) {
      contextId = taskContext.relatedTasks[0];
    }
    
    const subAgent = await this.subAgentPool.getSubAgent(contextId);
    
    if (taskContext.context) {
      subAgent.setContext('taskContext', taskContext.context);
    }
    
    this.taskContextManager.updateTaskStatus(taskId, 'processing');
    
    try {
      const params: SpawnSubagentParams = {
        task,
        label: `Task ${taskId}`,
        thread: true
      };
      
      const ctx: SpawnSubagentContext = {
        agentSessionKey: message.sessionId,
        agentChannel: message.channel,
        agentAccountId: message.userId
      };
      
      const result = await subAgent.runTask(task, params, ctx);
      
      if (result.status === 'accepted') {
        this.taskContextManager.updateTaskResult(taskId, result);
        const finalMessage = this.generateFinalMessage(message, result, taskContext);
        await this.sendMessage(message.channel, message.userId, finalMessage);
      } else {
        const errorMessage = `抱歉，处理时遇到问题：${result.error || '未知错误'}`;
        await this.sendMessage(message.channel, message.userId, errorMessage);
        this.taskContextManager.updateTaskStatus(taskId, 'failed');
      }
    } catch (error) {
      const errorMessage = `抱歉，子Agent执行失败：${(error as Error).message}`;
      await this.sendMessage(message.channel, message.userId, errorMessage);
      this.taskContextManager.updateTaskStatus(taskId, 'failed');
    } finally {
      this.activeTasks.delete(taskId);
      log.debug(`Task ${taskId} completed, active tasks: ${this.activeTasks.size}/${this.maxConcurrentTasks}`);
      this.processNextTask();
    }
  }

  private processNextTask() {
    if (this.taskQueue.length > 0 && this.activeTasks.size < this.maxConcurrentTasks) {
      const nextTask = this.taskQueue.shift();
      if (nextTask) {
        this.activeTasks.add(nextTask.taskId);
        this.processTask(nextTask.taskId, nextTask.message, nextTask.task);
        log.debug(`Processing next task from queue: ${nextTask.taskId}`);
      }
    }
  }

  private generateAssignmentMessage(task: string): string {
    const messages = [
      '好的，我查一下',
      '我去看看',
      '稍等，我帮你处理',
      '正在查询，请稍候',
      '好的，我马上帮你看一下'
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  private generateFinalMessage(message: TaskMessage, result: any, taskContext: any): string {
    const elapsed = Date.now() - message.timestamp;
    const isLongDelay = elapsed > 30000;
    
    if (isLongDelay) {
      return `你刚才${taskContext.originalMessage}，现在${this.extractResultSummary(result)}`;
    } else if (taskContext.relatedTasks.length > 0) {
      return `关于${taskContext.originalMessage}，${this.extractResultSummary(result)}`;
    } else {
      return this.extractResultSummary(result);
    }
  }

  private extractResultSummary(result: any): string {
    if (result.status === 'accepted') {
      return '任务已开始执行';
    } else if (result.error) {
      return `遇到错误：${result.error}`;
    }
    return '任务已完成';
  }

  private async sendMessage(channel: string, userId: string, content: string) {
    log.debug(`Sending message to ${userId}: ${content}`);
    // 这里应该调用实际的消息发送方法
  }

  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  getQueueLength(): number {
    return this.taskQueue.length;
  }

  shutdown() {
    this.taskQueue = [];
    this.activeTasks.clear();
    log.debug("Task manager shutdown");
  }
}

// 全局任务管理器实例
let globalTaskManager: TaskManager | null = null;

export function getTaskManager(): TaskManager {
  if (!globalTaskManager) {
    globalTaskManager = new TaskManager();
  }
  return globalTaskManager;
}

export function shutdownTaskManager() {
  if (globalTaskManager) {
    globalTaskManager.shutdown();
    globalTaskManager = null;
  }
}
