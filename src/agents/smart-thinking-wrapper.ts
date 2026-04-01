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
 * 4. 调用原始函数处理任务
 */
export async function runEmbeddedPiAgentWithSmartThinking(
  params: RunEmbeddedPiAgentParams
): Promise<EmbeddedPiRunResult> {
  // 1. 检查当前系统状态
  const subAgentPool = getSubAgentPool();
  const activeAgents = subAgentPool.getActiveAgents();
  const queueSize = subAgentPool.getQueueSize();
  
  // 2. 生成并发送快速回复
  const quickReplyPromise = generateQuickReply(params.prompt, params.config, activeAgents, queueSize);
  
  quickReplyPromise.then(async (quickReply) => {
    if (params.onPartialReply) {
      try {
        await params.onPartialReply(quickReply);
        log.debug(`Sent quick reply: ${quickReply}`);
      } catch (error) {
        log.warn(`Failed to send quick reply: ${String(error)}`);
      }
    }
  }).catch((error) => {
    log.warn(`Failed to generate quick reply: ${String(error)}`);
  });
  
  // 2. 评估任务复杂度
  const complexity = evaluateTaskComplexity(params.prompt);
  log.debug(`Task complexity: ${complexity}`);
  
  // 3. 根据复杂度设置thinking模式
  const adjustedThinkLevel = complexity === 'complex' ? 'medium' : 'off';
  log.debug(`Adjusted thinking level: ${adjustedThinkLevel}`);
  
  // 4. 调用原始函数处理任务
  const result = await runEmbeddedPiAgent({
    ...params,
    thinkLevel: adjustedThinkLevel
  });
  
  // 5. 组织详细的任务完成回复
  if (result) {
    // 检查是否有任务执行状态信息
    // 注意：taskSteps是我们在子Agent中添加的自定义字段
    const taskSteps = (result as any).meta?.taskSteps;
    if (taskSteps) {
      const failedSteps = taskSteps.filter((step: any) => step.status === 'failed');
      
      if (failedSteps.length > 0) {
        // 有失败的步骤，组织失败信息
        const errorMessages = failedSteps.map((step: any) => `${step.description}: ${step.error || '未知错误'}`);
        const errorSummary = errorMessages.join('\n');
        
        // 增强回复内容，包含失败信息
        if ((result as any).output) {
          (result as any).output = `${(result as any).output}\n\n任务执行过程中遇到一些问题：\n${errorSummary}`;
        } else if ((result as any).content) {
          (result as any).content = `${(result as any).content}\n\n任务执行过程中遇到一些问题：\n${errorSummary}`;
        }
      }
    }
  }
  
  return result;
}
