import { runEmbeddedPiAgent } from "./pi-embedded-runner/run.js";
import type { RunEmbeddedPiAgentParams } from "./pi-embedded-runner/run/params.js";
import type { EmbeddedPiRunResult } from "./pi-embedded-runner/types.js";
import { generateQuickReply, evaluateTaskComplexity } from "./smart-thinking.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getSubAgentPool } from "./subagent-pool.js";

const log = createSubsystemLogger("agents/smart-thinking-wrapper");

/**
 * 智能任务处理包装器
 * 1. 生成并发送快速回复
 * 2. 评估任务复杂度
 * 3. 根据复杂度设置thinking模式
 * 4. 对于复杂任务，使用子Agent进行并行处理
 * 5. 对于简单任务，直接调用原始函数处理
 */
export async function runEmbeddedPiAgentWithSmartThinking(
  params: RunEmbeddedPiAgentParams
): Promise<EmbeddedPiRunResult> {
  // 1. 检查当前系统状态
  const subAgentPool = getSubAgentPool();
  const activeAgents = subAgentPool.getActiveAgents();
  const queueSize = subAgentPool.getQueueSize();
  
  log.debug(`Subagent pool status: ${activeAgents} active, ${queueSize} queued`);
  
  // 2. 生成并发送快速回复
  const quickReplyPromise = generateQuickReply(params.prompt, params.config, activeAgents, queueSize);
  
  quickReplyPromise.then(async (quickReply) => {
    if (params.onPartialReply) {
      try {
        await params.onPartialReply({ text: quickReply });
        log.debug(`Sent quick reply: ${quickReply}`);
      } catch (error) {
        log.warn(`Failed to send quick reply: ${String(error)}`);
      }
    }
  }).catch((error) => {
    log.warn(`Failed to generate quick reply: ${String(error)}`);
  });
  
  // 3. 评估任务复杂度
  const complexity = evaluateTaskComplexity(params.prompt);
  log.debug(`Task complexity: ${complexity}`);
  
  // 4. 根据复杂度设置thinking模式
  const adjustedThinkLevel = complexity === 'complex' ? 'medium' : 'off';
  log.debug(`Adjusted thinking level: ${adjustedThinkLevel}`);
  
  // 5. 根据任务复杂度决定处理方式
  if (complexity === 'complex') {
    log.info(`Using subagent for complex task: ${params.prompt.substring(0, 50)}...`);
    
    try {
      // 获取子Agent并分配任务
      const agent = await subAgentPool.getSubAgent();
      log.debug(`Assigned task to subagent: ${agent.agentId}`);
      
      // 定义任务步骤
      const stepId = agent.addTaskStep('Processing complex query');
      agent.updateTaskStep(stepId, 'in_progress');
      
      // 并行处理任务
      const resultPromise = runEmbeddedPiAgent({
        ...params,
        thinkLevel: adjustedThinkLevel
      });
      
      // 等待任务完成
      const result = await resultPromise;
      
      // 更新任务步骤状态
      agent.updateTaskStep(stepId, 'completed');
      
      // 组织详细的任务完成回复
      if (result) {
        // 添加任务执行状态信息
        (result as any).meta = {
          ...(result as any).meta,
          taskSteps: agent.getTaskSteps()
        };
      }
      
      log.info(`Subagent ${agent.agentId} completed task`);
      return result;
    } catch (error) {
      log.error(`Failed to process task with subagent: ${String(error)}`);
      //  fallback to direct processing if subagent fails
      return await runEmbeddedPiAgent({
        ...params,
        thinkLevel: adjustedThinkLevel
      });
    }
  } else {
    // 对于简单任务，直接处理
    log.debug(`Processing simple task directly`);
    return await runEmbeddedPiAgent({
      ...params,
      thinkLevel: adjustedThinkLevel
    });
  }
}
