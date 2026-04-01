import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/task-context");

export interface TaskContext {
  taskId: string;
  sessionId: string;
  originalMessage: string;
  timestamp: number;
  relatedTasks: string[];
  context: any;
  result?: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface SessionContext {
  sessionId: string;
  baseContext: any;
  activeTasks: string[];
  history: Array<{
    taskId: string;
    message: string;
    result: any;
    timestamp: number;
  }>;
}

export class TaskContextManager {
  private taskContexts: Map<string, TaskContext> = new Map();
  private sessionContexts: Map<string, SessionContext> = new Map();

  createTaskContext(sessionId: string, taskId: string, message: any): TaskContext {
    const sessionContext = this.getOrCreateSessionContext(sessionId);
    const relatedTasks = this.findRelatedTasks(sessionId, message.content);
    
    const taskContext: TaskContext = {
      taskId,
      sessionId,
      originalMessage: message.content,
      timestamp: Date.now(),
      relatedTasks,
      context: {
        ...sessionContext.baseContext,
        ...this.extractContextFromRelatedTasks(relatedTasks)
      },
      status: 'pending'
    };
    
    this.taskContexts.set(taskId, taskContext);
    sessionContext.activeTasks.push(taskId);
    
    log.debug(`Created task context: ${taskId} for session: ${sessionId}, related tasks: ${relatedTasks.length}`);
    return taskContext;
  }

  private getOrCreateSessionContext(sessionId: string): SessionContext {
    if (!this.sessionContexts.has(sessionId)) {
      this.sessionContexts.set(sessionId, {
        sessionId,
        baseContext: {},
        activeTasks: [],
        history: []
      });
    }
    return this.sessionContexts.get(sessionId)!;
  }

  private findRelatedTasks(sessionId: string, message: string): string[] {
    const sessionContext = this.sessionContexts.get(sessionId);
    if (!sessionContext) return [];
    
    const messageKeywords = this.extractKeywords(message);
    
    return sessionContext.activeTasks.filter(taskId => {
      const taskContext = this.taskContexts.get(taskId);
      if (!taskContext) return false;
      
      const taskKeywords = this.extractKeywords(taskContext.originalMessage);
      return taskKeywords.some(keyword => messageKeywords.includes(keyword));
    });
  }

  private extractContextFromRelatedTasks(taskIds: string[]): any {
    const context: any = {};
    
    for (const taskId of taskIds) {
      const taskContext = this.taskContexts.get(taskId);
      if (taskContext && taskContext.result) {
        context[`task_${taskId}`] = taskContext.result;
      }
    }
    
    return context;
  }

  private extractKeywords(text: string): string[] {
    return text.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这'].includes(word));
  }

  updateTaskStatus(taskId: string, status: 'processing' | 'completed' | 'failed') {
    const taskContext = this.taskContexts.get(taskId);
    if (taskContext) {
      taskContext.status = status;
      log.debug(`Updated task ${taskId} status to ${status}`);
    }
  }

  updateTaskResult(taskId: string, result: any) {
    const taskContext = this.taskContexts.get(taskId);
    if (taskContext) {
      taskContext.result = result;
      taskContext.status = 'completed';
      
      const sessionContext = this.sessionContexts.get(taskContext.sessionId);
      if (sessionContext) {
        sessionContext.history.push({
          taskId,
          message: taskContext.originalMessage,
          result,
          timestamp: Date.now()
        });
        
        // 保持历史记录在合理范围内
        if (sessionContext.history.length > 100) {
          sessionContext.history = sessionContext.history.slice(-100);
        }
        
        // 从活跃任务中移除
        sessionContext.activeTasks = sessionContext.activeTasks.filter(id => id !== taskId);
      }
      
      log.debug(`Updated task ${taskId} result`);
    }
  }

  getTaskContext(taskId: string): TaskContext | undefined {
    return this.taskContexts.get(taskId);
  }

  getSessionContext(sessionId: string): SessionContext | undefined {
    return this.sessionContexts.get(sessionId);
  }

  cleanupOldTasks(maxAge: number = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const oldTasks: string[] = [];
    
    for (const [taskId, taskContext] of this.taskContexts.entries()) {
      if (now - taskContext.timestamp > maxAge) {
        oldTasks.push(taskId);
      }
    }
    
    for (const taskId of oldTasks) {
      const taskContext = this.taskContexts.get(taskId);
      if (taskContext) {
        const sessionContext = this.sessionContexts.get(taskContext.sessionId);
        if (sessionContext) {
          sessionContext.activeTasks = sessionContext.activeTasks.filter(id => id !== taskId);
        }
        this.taskContexts.delete(taskId);
        log.debug(`Cleaned up old task: ${taskId}`);
      }
    }
  }

  shutdown() {
    this.taskContexts.clear();
    this.sessionContexts.clear();
    log.debug("Task context manager shutdown");
  }
}

// 全局任务上下文管理器实例
let globalTaskContextManager: TaskContextManager | null = null;

export function getTaskContextManager(): TaskContextManager {
  if (!globalTaskContextManager) {
    globalTaskContextManager = new TaskContextManager();
  }
  return globalTaskContextManager;
}

export function shutdownTaskContextManager() {
  if (globalTaskContextManager) {
    globalTaskContextManager.shutdown();
    globalTaskContextManager = null;
  }
}
