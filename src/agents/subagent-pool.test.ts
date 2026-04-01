import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentPool, getSubAgentPool, shutdownSubAgentPool } from './subagent-pool.js';

describe('SubAgentPool', () => {
  beforeEach(() => {
    shutdownSubAgentPool();
  });

  afterEach(() => {
    shutdownSubAgentPool();
  });

  it('should create a subagent pool with default settings', () => {
    const pool = getSubAgentPool();
    expect(pool).toBeInstanceOf(SubAgentPool);
    expect(pool.getPoolSize()).toBe(0);
  });

  it('should create new agents when pool is empty', async () => {
    const pool = getSubAgentPool();
    const agent1 = await pool.getSubAgent();
    const agent2 = await pool.getSubAgent();
    
    expect(agent1.agentId).toBeDefined();
    expect(agent2.agentId).toBeDefined();
    expect(agent1.agentId).not.toBe(agent2.agentId);
    expect(pool.getPoolSize()).toBe(2);
  });

  it('should reuse existing agents when contextId is provided', async () => {
    const pool = getSubAgentPool();
    const agent1 = await pool.getSubAgent('test-context');
    const agent2 = await pool.getSubAgent('test-context');
    
    expect(agent1.agentId).toBe(agent2.agentId);
    expect(pool.getPoolSize()).toBe(1);
  });

  it('should create new agents when contextId changes', async () => {
    const pool = getSubAgentPool();
    const agent1 = await pool.getSubAgent('context1');
    const agent2 = await pool.getSubAgent('context2');
    
    expect(agent1.agentId).not.toBe(agent2.agentId);
    expect(pool.getPoolSize()).toBe(2);
  });

  it('should manage agent context', async () => {
    const pool = getSubAgentPool();
    const agent = await pool.getSubAgent('test-context');
    
    agent.setContext('key1', 'value1');
    expect(agent.getContext('key1')).toBe('value1');
    
    agent.setContext('key2', 'value2');
    expect(agent.getContext('key2')).toBe('value2');
    expect(agent.getContext('key1')).toBe('value1');
  });

  it('should return active agent count', async () => {
    const pool = getSubAgentPool();
    await pool.getSubAgent('context1');
    await pool.getSubAgent('context2');
    
    expect(pool.getActiveAgents()).toBe(2);
  });

  it('should shutdown cleanly', () => {
    const pool = getSubAgentPool();
    pool.shutdown();
    expect(pool.getPoolSize()).toBe(0);
  });
});
