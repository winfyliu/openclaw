import crypto from "node:crypto";
import { spawnSubagentDirect, type SpawnSubagentParams, type SpawnSubagentContext } from "./subagent-spawn.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/subagent-pool");

export interface SubAgentInstance {
  agentId: string;
  lastUsed: number;
  context: Map<string, any>;
  updateLastUsed: () => void;
  setContext: (key: string, value: any) => void;
  getContext: (key: string) => any;
  runTask: (task: string, params: SpawnSubagentParams, ctx: SpawnSubagentContext) => Promise<any>;
  shutdown: () => void;
}

export class SubAgentPool {
  private pool: Map<string, SubAgentInstance> = new Map();
  private maxPoolSize: number;
  private idleTimeout: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor(maxPoolSize: number = 5, idleTimeout: number = 300000) {
    this.maxPoolSize = maxPoolSize;
    this.idleTimeout = idleTimeout;
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleAgents();
    }, 60000); // 每分钟清理一次
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
      updateLastUsed: function() {
        this.lastUsed = Date.now();
      },
      setContext: function(key: string, value: any) {
        this.context.set(key, value);
      },
      getContext: function(key: string): any {
        return this.context.get(key);
      },
      runTask: async function(task: string, params: SpawnSubagentParams, ctx: SpawnSubagentContext) {
        this.updateLastUsed();
        return spawnSubagentDirect(params, ctx);
      },
      shutdown: function() {
        this.context.clear();
      }
    };

    this.pool.set(agentId, agent);
    log.debug(`Created new subagent: ${agentId}`);
    return agent;
  }

  private cleanupIdleAgents() {
    const now = Date.now();
    for (const [agentId, agent] of this.pool.entries()) {
      if (now - agent.lastUsed > this.idleTimeout) {
        agent.shutdown();
        this.pool.delete(agentId);
        log.debug(`Cleaned up idle subagent: ${agentId}`);
      }
    }
  }

  getPoolSize(): number {
    return this.pool.size;
  }

  getActiveAgents(): number {
    const now = Date.now();
    return Array.from(this.pool.values()).filter(agent => now - agent.lastUsed < 5 * 60 * 1000).length;
  }

  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const agent of this.pool.values()) {
      agent.shutdown();
    }
    this.pool.clear();
    log.debug("Subagent pool shutdown");
  }
}

// 全局子Agent池实例
let globalSubAgentPool: SubAgentPool | null = null;

export function getSubAgentPool(): SubAgentPool {
  if (!globalSubAgentPool) {
    globalSubAgentPool = new SubAgentPool();
  }
  return globalSubAgentPool;
}

export function shutdownSubAgentPool() {
  if (globalSubAgentPool) {
    globalSubAgentPool.shutdown();
    globalSubAgentPool = null;
  }
}
