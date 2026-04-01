import { createSubsystemLogger } from "../logging/subsystem.js";
import { getTaskContextManager } from "./task-context-manager.js";

const log = createSubsystemLogger("agents/task-continuation");

export interface TaskCorrelation {
  taskId: string;
  similarity: number;
  context: any;
}

export class TaskContinuationOptimizer {
  private taskContextManager = getTaskContextManager();

  findRelatedTasks(sessionId: string, currentTask: string, maxResults: number = 3): TaskCorrelation[] {
    const sessionContext = this.taskContextManager.getSessionContext(sessionId);
    if (!sessionContext) return [];

    const currentKeywords = this.extractKeywords(currentTask);
    const correlations: TaskCorrelation[] = [];

    for (const taskId of sessionContext.activeTasks) {
      const taskContext = this.taskContextManager.getTaskContext(taskId);
      if (!taskContext) continue;

      const taskKeywords = this.extractKeywords(taskContext.originalMessage);
      const similarity = this.calculateSimilarity(currentKeywords, taskKeywords);

      if (similarity > 0.3) { // 相似度阈值
        correlations.push({
          taskId,
          similarity,
          context: taskContext.context
        });
      }
    }

    // 按相似度排序并返回前N个
    return correlations
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);
  }

  private extractKeywords(text: string): Set<string> {
    return new Set(
      text.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2)
        .filter(word => !['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这'].includes(word))
    );
  }

  private calculateSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 || set2.size === 0) return 0;

    let intersection = 0;
    for (const word of set1) {
      if (set2.has(word)) {
        intersection++;
      }
    }

    const union = set1.size + set2.size - intersection;
    return intersection / union;
  }

  optimizeContextInheritance(currentTask: string, relatedTasks: TaskCorrelation[]): any {
    const optimizedContext: any = {};

    // 按相似度排序，优先使用相似度高的任务上下文
    relatedTasks.sort((a, b) => b.similarity - a.similarity);

    for (const task of relatedTasks) {
      if (task.context) {
        // 合并上下文，保留相似度高的任务的上下文
        Object.keys(task.context).forEach(key => {
          if (!optimizedContext[key]) {
            optimizedContext[key] = task.context[key];
          }
        });
      }
    }

    // 添加当前任务的关键词作为上下文
    optimizedContext.currentTaskKeywords = Array.from(this.extractKeywords(currentTask));

    return optimizedContext;
  }

  generateTaskSummary(taskId: string): string {
    const taskContext = this.taskContextManager.getTaskContext(taskId);
    if (!taskContext) return '';

    if (taskContext.result) {
      return this.summarizeTaskResult(taskContext);
    }

    return taskContext.originalMessage;
  }

  private summarizeTaskResult(taskContext: any): string {
    if (taskContext.result.status === 'accepted') {
      return `任务 "${taskContext.originalMessage}" 已开始执行`;
    } else if (taskContext.result.error) {
      return `任务 "${taskContext.originalMessage}" 执行失败: ${taskContext.result.error}`;
    }
    return `任务 "${taskContext.originalMessage}" 已完成`;
  }

  detectTaskPattern(sessionId: string): string[] {
    const sessionContext = this.taskContextManager.getSessionContext(sessionId);
    if (!sessionContext || sessionContext.history.length === 0) return [];

    const taskTypes: Record<string, number> = {};

    for (const historyItem of sessionContext.history) {
      const taskType = this.classifyTaskType(historyItem.message);
      taskTypes[taskType] = (taskTypes[taskType] || 0) + 1;
    }

    // 返回最常见的任务类型
    return Object.entries(taskTypes)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([type]) => type);
  }

  private classifyTaskType(task: string): string {
    const taskLower = task.toLowerCase();

    if (taskLower.includes('天气') || taskLower.includes('温度') || taskLower.includes(' forecast')) {
      return 'weather';
    }
    if (taskLower.includes('查询') || taskLower.includes('搜索') || taskLower.includes('find') || taskLower.includes('search')) {
      return 'search';
    }
    if (taskLower.includes('计算') || taskLower.includes('算') || taskLower.includes('calculate') || taskLower.includes('compute')) {
      return 'calculation';
    }
    if (taskLower.includes('翻译') || taskLower.includes('translate') || taskLower.includes('translation')) {
      return 'translation';
    }
    if (taskLower.includes('攻略') || taskLower.includes('指南') || taskLower.includes('guide') || taskLower.includes('攻略')) {
      return 'guide';
    }
    if (taskLower.includes('代码') || taskLower.includes('编程') || taskLower.includes('code') || taskLower.includes('program')) {
      return 'coding';
    }

    return 'other';
  }

  predictNextTask(sessionId: string): string | null {
    const sessionContext = this.taskContextManager.getSessionContext(sessionId);
    if (!sessionContext || sessionContext.history.length < 2) return null;

    // 简单的序列模式预测
    const recentTasks = sessionContext.history.slice(-3).map(item => this.classifyTaskType(item.message));
    
    // 查找模式
    if (recentTasks.length >= 2) {
      const lastTask = recentTasks[recentTasks.length - 1];
      const secondLastTask = recentTasks[recentTasks.length - 2];

      // 简单的模式匹配
      if (secondLastTask === 'weather' && lastTask === 'guide') {
        return '可能需要交通信息或住宿建议';
      }
      if (secondLastTask === 'search' && lastTask === 'search') {
        return '可能需要更详细的信息';
      }
    }

    return null;
  }
}

// 全局任务延续优化器实例
let globalTaskContinuationOptimizer: TaskContinuationOptimizer | null = null;

export function getTaskContinuationOptimizer(): TaskContinuationOptimizer {
  if (!globalTaskContinuationOptimizer) {
    globalTaskContinuationOptimizer = new TaskContinuationOptimizer();
  }
  return globalTaskContinuationOptimizer;
}

export function shutdownTaskContinuationOptimizer() {
  globalTaskContinuationOptimizer = null;
}
