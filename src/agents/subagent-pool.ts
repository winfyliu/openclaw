import crypto from "node:crypto";
import { spawnSubagentDirect, type SpawnSubagentParams, type SpawnSubagentContext } from "./subagent-spawn.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { evaluateTaskComplexity } from "./smart-thinking.js";

const log = createSubsystemLogger("agents/subagent-pool");

export interface TaskStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface SubAgentInstance {
  agentId: string;
  lastUsed: number;
  context: Map<string, any>;
  isBusy: boolean;
  activeTask?: string;
  taskSteps: TaskStep[];
  currentStep?: string;
  toolWaitStartTime?: number;
  toolTimeout?: number;
  updateLastUsed: () => void;
  setContext: (key: string, value: any) => void;
  getContext: (key: string) => any;
  runTask: (task: string, params: SpawnSubagentParams, ctx: SpawnSubagentContext) => Promise<any>;
  addTaskStep: (description: string) => string;
  updateTaskStep: (stepId: string, status: 'in_progress' | 'completed' | 'failed', error?: string) => void;
  setToolWait: (timeout: number) => void;
  clearToolWait: () => void;
  getTaskSteps: () => TaskStep[];
  shutdown: () => void;
}

export interface QueuedTask {
  taskId: string;
  task: string;
  params: SpawnSubagentParams;
  ctx: SpawnSubagentContext;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  createdAt: number;
  priority: 'low' | 'medium' | 'high';
}

export class SubAgentPool {
  private pool: Map<string, SubAgentInstance> = new Map();
  private taskQueue: QueuedTask[] = [];
  private maxPoolSize: number;
  private idleTimeout: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor(maxPoolSize: number = 5, idleTimeout: number = 300000) {
    this.maxPoolSize = maxPoolSize;
    this.idleTimeout = idleTimeout;
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleAgents();
      this.processTaskQueue();
      this.monitorTaskStatus();
    }, 10000); // 每10秒清理一次并处理队列
  }

  async getSubAgent(contextId?: string): Promise<SubAgentInstance> {
    if (contextId && this.pool.has(contextId)) {
      const agent = this.pool.get(contextId)!;
      agent.updateLastUsed();
      return agent;
    }

    if (this.pool.size >= this.maxPoolSize) {
      this.cleanupIdleAgents();
      if (this.pool.size >= this.maxPoolSize) {
        return this.createNewAgent();
      }
    }

    return this.createNewAgent();
  }

  private async createNewAgent(): Promise<SubAgentInstance> {
    const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const agent: SubAgentInstance = {
      agentId,
      lastUsed: Date.now(),
      context: new Map(),
      isBusy: false,
      taskSteps: [],
      updateLastUsed: function() {
        this.lastUsed = Date.now();
      },
      setContext: function(key: string, value: any) {
        this.context.set(key, value);
      },
      getContext: function(key: string): any {
        return this.context.get(key);
      },
      addTaskStep: function(description: string): string {
        const stepId = `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.taskSteps.push({
          id: stepId,
          description,
          status: 'pending',
          startTime: Date.now()
        });
        return stepId;
      },
      updateTaskStep: function(stepId: string, status: 'in_progress' | 'completed' | 'failed', error?: string) {
        const step = this.taskSteps.find(s => s.id === stepId);
        if (step) {
          step.status = status;
          if (status === 'completed' || status === 'failed') {
            step.endTime = Date.now();
            if (error) {
              step.error = error;
            }
          }
          if (status === 'in_progress') {
            this.currentStep = stepId;
          }
        }
      },
      setToolWait: function(timeout: number) {
        this.toolWaitStartTime = Date.now();
        this.toolTimeout = timeout;
      },
      clearToolWait: function() {
        this.toolWaitStartTime = undefined;
        this.toolTimeout = undefined;
      },
      getTaskSteps: function(): TaskStep[] {
        return this.taskSteps;
      },
      runTask: async function(task: string, params: SpawnSubagentParams, ctx: SpawnSubagentContext) {
        this.updateLastUsed();
        this.isBusy = true;
        this.activeTask = task;
        this.taskSteps = [];
        
        try {
          // 评估任务复杂度
          const complexity = evaluateTaskComplexity(task);
          
          // 根据复杂度设置thinking模式
          const thinkingMode = complexity === 'complex' ? 'medium' : 'off';
          
          // 覆盖params中的thinking设置
          const adjustedParams = {
            ...params,
            thinking: thinkingMode
          };
          
          log.debug(`Running task with complexity ${complexity}, thinking mode ${thinkingMode}`);
          
          // 添加任务步骤
          const planningStep = this.addTaskStep('任务规划');
          this.updateTaskStep(planningStep, 'in_progress');
          
          // 执行任务
          const executionStep = this.addTaskStep('任务执行');
          this.updateTaskStep(planningStep, 'completed');
          this.updateTaskStep(executionStep, 'in_progress');
          
          const result = await spawnSubagentDirect(adjustedParams, ctx);
          
          // 完成任务步骤
          this.updateTaskStep(executionStep, 'completed');
          
          // 记录任务历史，用于上下文继承
          const previousTasks = this.getContext('previousTasks') || [];
          previousTasks.push(task);
          // 只保留最近10个任务
          if (previousTasks.length > 10) {
            previousTasks.shift();
          }
          this.setContext('previousTasks', previousTasks);
          
          // 记录会话ID
          if ((ctx as any).sessionId) {
            this.setContext('sessionId', (ctx as any).sessionId);
          }
          
          return result;
        } catch (error) {
          // 标记任务步骤失败
          if (this.currentStep) {
            this.updateTaskStep(this.currentStep, 'failed', error instanceof Error ? error.message : String(error));
          }
          throw error;
        } finally {
          this.isBusy = false;
          this.activeTask = undefined;
          this.currentStep = undefined;
          this.clearToolWait();
          // 任务完成后处理队列
          process.nextTick(() => {
            SubAgentPool.instance?.processTaskQueue();
          });
        }
      },
      shutdown: function() {
        this.context.clear();
        this.taskSteps = [];
        this.currentStep = undefined;
        this.clearToolWait();
      }
    };

    this.pool.set(agentId, agent);
    log.debug(`Created new subagent: ${agentId}`);
    return agent;
  }

  private cleanupIdleAgents() {
    const now = Date.now();
    for (const [agentId, agent] of this.pool.entries()) {
      if (!agent.isBusy && now - agent.lastUsed > this.idleTimeout) {
        agent.shutdown();
        this.pool.delete(agentId);
        log.debug(`Cleaned up idle subagent: ${agentId}`);
      }
    }
  }

  private processTaskQueue() {
    if (this.taskQueue.length === 0) {
      return;
    }

    // 查找空闲的Agent
    const idleAgent = Array.from(this.pool.values()).find(agent => !agent.isBusy);
    
    if (idleAgent) {
      // 取出队列中的第一个任务
      const task = this.taskQueue.shift();
      if (task) {
        log.debug(`Processing queued task ${task.taskId} with agent ${idleAgent.agentId}`);
        // 执行任务
        idleAgent.runTask(task.task, task.params, task.ctx)
          .then(task.resolve)
          .catch(task.reject);
      }
    } else if (this.pool.size < this.maxPoolSize) {
      // 如果没有空闲Agent但池未满，创建新Agent
      this.createNewAgent().then(agent => {
        const task = this.taskQueue.shift();
        if (task) {
          log.debug(`Processing queued task ${task.taskId} with new agent ${agent.agentId}`);
          agent.runTask(task.task, task.params, task.ctx)
            .then(task.resolve)
            .catch(task.reject);
        }
      });
    }
  }

  private monitorTaskStatus() {
    const now = Date.now();
    
    // 检查每个子Agent的任务状态
    for (const [agentId, agent] of this.pool.entries()) {
      if (agent.isBusy) {
        // 检查工具等待超时
        if (agent.toolWaitStartTime && agent.toolTimeout) {
          const elapsed = now - agent.toolWaitStartTime;
          if (elapsed > agent.toolTimeout) {
            log.warn(`Agent ${agentId} tool wait timeout after ${elapsed}ms`);
            // 这里可以添加处理工具超时的逻辑
            agent.clearToolWait();
          }
        }
        
        // 检查任务执行超时
        const taskSteps = agent.getTaskSteps();
        if (taskSteps.length > 0) {
          const firstStep = taskSteps[0];
          const taskElapsed = now - firstStep.startTime;
          // 任务执行超过5分钟视为超时
          if (taskElapsed > 5 * 60 * 1000) {
            log.warn(`Agent ${agentId} task execution timeout after ${taskElapsed}ms`);
            // 这里可以添加处理任务超时的逻辑
          }
        }
        
        // 检查任务步骤状态
        const inProgressSteps = agent.getTaskSteps().filter(step => step.status === 'in_progress');
        if (inProgressSteps.length > 0) {
          for (const step of inProgressSteps) {
            const stepElapsed = now - step.startTime;
            // 步骤执行超过2分钟视为异常
            if (stepElapsed > 2 * 60 * 1000) {
              log.warn(`Agent ${agentId} step "${step.description}" taking too long: ${stepElapsed}ms`);
              // 这里可以添加处理步骤超时的逻辑
            }
          }
        }
      }
    }
  }

  async runTaskWithQueue(task: string, params: SpawnSubagentParams, ctx: SpawnSubagentContext): Promise<any> {
    return new Promise((resolve, reject) => {
      // 评估任务优先级
      const priority = this.evaluateTaskPriority(task);
      
      // 查找与任务相关的空闲Agent（上下文继承）
      const relatedAgent = this.findRelatedAgent(task, ctx);
      
      if (relatedAgent && !relatedAgent.isBusy) {
        log.debug(`Running task with related agent ${relatedAgent.agentId} (context inheritance, priority: ${priority})`);
        relatedAgent.runTask(task, params, ctx)
          .then(resolve)
          .catch(reject);
      } else {
        // 查找空闲的Agent
        const idleAgent = Array.from(this.pool.values()).find(agent => !agent.isBusy);
        
        if (idleAgent) {
          log.debug(`Running task immediately with agent ${idleAgent.agentId} (priority: ${priority})`);
          idleAgent.runTask(task, params, ctx)
            .then(resolve)
            .catch(reject);
        } else if (this.pool.size < this.maxPoolSize) {
          // 如果没有空闲Agent但池未满，创建新Agent
          this.createNewAgent().then(agent => {
            log.debug(`Running task with new agent ${agent.agentId} (priority: ${priority})`);
            agent.runTask(task, params, ctx)
              .then(resolve)
              .catch(reject);
          }).catch(reject);
        } else {
          // 池已满，将任务加入队列
          const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.taskQueue.push({
            taskId,
            task,
            params,
            ctx,
            resolve,
            reject,
            createdAt: Date.now(),
            priority
          });
          // 按优先级排序队列
          this.taskQueue.sort((a, b) => {
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          });
          log.debug(`Task ${taskId} queued with priority ${priority}, queue size: ${this.taskQueue.length}`);
        }
      }
    });
  }

  private evaluateTaskPriority(task: string): 'low' | 'medium' | 'high' {
    // 评估任务优先级
    const highPriorityKeywords = ['紧急', '立刻', '马上', '现在', '急需', '紧急情况', '重要', '关键'];
    const mediumPriorityKeywords = ['请', '帮我', '麻烦', '能否', '是否', '可以'];
    
    // 检查高优先级关键词
    for (const keyword of highPriorityKeywords) {
      if (task.includes(keyword)) {
        return 'high';
      }
    }
    
    // 检查中优先级关键词
    for (const keyword of mediumPriorityKeywords) {
      if (task.includes(keyword)) {
        return 'medium';
      }
    }
    
    // 默认低优先级
    return 'low';
  }

  private findRelatedAgent(task: string, ctx: SpawnSubagentContext): SubAgentInstance | undefined {
    // 查找与任务相关的Agent
    // 1. 首先查找具有相同会话ID的Agent
    if ((ctx as any).sessionId) {
      for (const agent of this.pool.values()) {
        if (!agent.isBusy && agent.getContext('sessionId') === (ctx as any).sessionId) {
          return agent;
        }
      }
    }
    
    // 2. 查找处理过相关任务的Agent
    for (const agent of this.pool.values()) {
      if (!agent.isBusy) {
        const previousTasks = agent.getContext('previousTasks') || [];
        if (previousTasks.some((prevTask: string) => this.isTaskRelated(prevTask, task))) {
          return agent;
        }
      }
    }
    
    return undefined;
  }

  private isTaskRelated(task1: string, task2: string): boolean {
    // 判断两个任务是否相关
    // 1. 检查关键词重叠
    const keywords1 = this.extractKeywords(task1);
    const keywords2 = this.extractKeywords(task2);
    const commonKeywords = keywords1.filter(keyword => keywords2.includes(keyword));
    
    // 如果有2个以上的共同关键词，则认为任务相关
    if (commonKeywords.length >= 2) {
      return true;
    }
    
    // 2. 检查是否有明显的上下文延续词
    const contextWords = ['继续', '接着', '然后', '还有', '另外', '再', '又', '还'];
    return contextWords.some(word => task2.includes(word));
  }

  private extractKeywords(text: string): string[] {
    // 提取关键词
    const stopWords = ['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这'];
    const words = text.split(/\s+|,|，|。|！|？|；|；/).filter(word => word.length > 1 && !stopWords.includes(word));
    return words;
  }

  getPoolSize(): number {
    return this.pool.size;
  }

  getActiveAgents(): number {
    return Array.from(this.pool.values()).filter(agent => agent.isBusy).length;
  }

  getIdleAgents(): number {
    return Array.from(this.pool.values()).filter(agent => !agent.isBusy).length;
  }

  getQueueSize(): number {
    return this.taskQueue.length;
  }

  getActiveTasks(): Array<{ agentId: string; task: string }> {
    return Array.from(this.pool.values())
      .filter(agent => agent.isBusy && agent.activeTask)
      .map(agent => ({ agentId: agent.agentId, task: agent.activeTask! }));
  }

  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const agent of this.pool.values()) {
      agent.shutdown();
    }
    this.pool.clear();
    // 拒绝所有排队的任务
    this.taskQueue.forEach(task => {
      task.reject(new Error('Subagent pool shutdown'));
    });
    this.taskQueue = [];
    log.debug("Subagent pool shutdown");
  }

  // 单例实例
  public static instance: SubAgentPool | null = null;
}

// 全局子Agent池实例
let globalSubAgentPool: SubAgentPool | null = null;

export function getSubAgentPool(): SubAgentPool {
  if (!globalSubAgentPool) {
    globalSubAgentPool = new SubAgentPool();
    SubAgentPool.instance = globalSubAgentPool;
  }
  return globalSubAgentPool;
}

export function shutdownSubAgentPool() {
  if (globalSubAgentPool) {
    globalSubAgentPool.shutdown();
    SubAgentPool.instance = null;
    globalSubAgentPool = null;
  }
}
