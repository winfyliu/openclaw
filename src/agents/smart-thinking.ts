import { SpawnSubagentParams, SpawnSubagentContext } from "./subagent-spawn.js";
import { getSubAgentPool } from "./subagent-pool.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { streamSimple } from "@mariozechner/pi-ai";

const log = createSubsystemLogger("agents/smart-thinking");

// 任务复杂度评估
export function evaluateTaskComplexity(message: string): 'simple' | 'complex' {
  // 基于消息长度、关键词和结构评估复杂度
  const messageLength = message.length;
  const complexKeywords = [
    '分析', '研究', '设计', '规划', '开发', '实现',
    '分析一下', '研究一下', '设计一下', '规划一下', '开发一下', '实现一下',
    '详细', '深入', '全面', '完整', '系统', '方案'
  ];
  
  // 长度判断
  if (messageLength > 100) {
    return 'complex';
  }
  
  // 关键词判断
  for (const keyword of complexKeywords) {
    if (message.includes(keyword)) {
      return 'complex';
    }
  }
  
  // 结构判断（例如包含多个问题或需求）
  const questionMarks = (message.match(/\?/g) || []).length;
  if (questionMarks > 2) {
    return 'complex';
  }
  
  return 'simple';
}

// 快速回复模板
const QUICK_REPLY_TEMPLATES = [
  '好的，我正在处理',
  '稍等，我马上查一下',
  '收到，我正在分析',
  '好的，我帮您看看',
  '稍等片刻，我正在处理'
];

// 如果LLM生成失败，使用模板回复
export function getFallbackQuickReply(): string {
  return QUICK_REPLY_TEMPLATES[Math.floor(Math.random() * QUICK_REPLY_TEMPLATES.length)];
}

// LLM调用封装
export async function callLLM(model: any, prompt: string, options: any): Promise<any> {
  try {
    const stream = await streamSimple(model, {
      messages: [
        {
          role: "user" as const,
          content: prompt,
          timestamp: Date.now()
        }
      ]
    }, options);
    
    const result = await stream.result();
    return result;
  } catch (error) {
    log.error(`LLM call failed: ${String(error)}`);
    throw error;
  }
}

// 快速回复生成器
export async function generateQuickReply(message: string, config: any, activeAgents: number = 0, queueSize: number = 0): Promise<string> {
  try {
    log.debug(`Generating quick reply for message: ${message.substring(0, 50)}...`);
    
    // 构建系统状态信息
    let systemStatus = '';
    if (activeAgents > 0 || queueSize > 0) {
      if (queueSize > 0) {
        systemStatus = `（前面还有${queueSize}个任务）`;
      } else {
        systemStatus = '（处理中）';
      }
    }
    
    // 直接生成简单的快速回复，避免依赖外部LLM
    const fallbackReplies = [
      `收到，正在处理${systemStatus}`,
      `好的，稍等片刻${systemStatus}`,
      `正在为你查询${systemStatus}`,
      `已收到消息，马上处理${systemStatus}`
    ];
    
    const randomIndex = Math.floor(Math.random() * fallbackReplies.length);
    const quickReply = fallbackReplies[randomIndex];
    
    log.debug(`Generated quick reply: ${quickReply}`);
    return quickReply;
  } catch (error) {
    log.warn(`Failed to generate quick reply: ${String(error)}`);
    // 根据系统状态生成后备回复
    if (queueSize > 0) {
      return `好的，前面还有${queueSize}个任务，稍等`;
    } else if (activeAgents > 0) {
      return '好的，我正在处理，稍等';
    } else {
      return getFallbackQuickReply();
    }
  }
}

// 智能任务处理
export async function processTaskIntelligently(message: any, params: any, ctx: any) {
  // 1. 异步生成并发送快速回复
  const quickReplyPromise = generateQuickReply(message.content, params.config);
  
  quickReplyPromise.then(async (quickReply) => {
    if (params.onPartialReply) {
      await params.onPartialReply(quickReply);
    }
  }).catch((error) => {
    log.warn(`Failed to send quick reply: ${String(error)}`);
  });
  
  // 2. 分析任务复杂度
  const complexity = evaluateTaskComplexity(message.content);
  
  // 3. 异步处理任务
  return new Promise(async (resolve, reject) => {
    try {
      const pool = getSubAgentPool();
      const agent = await pool.getSubAgent();
      
      const result = await agent.runTask(
        message.content,
        {
          task: message.content,
          model: 'custom-api-deepseek-com/deepseek-chat',
          thinking: complexity === 'complex' ? 'medium' : 'off'
        },
        {
          sessionId: params.sessionId,
          runId: params.runId
        } as any
      );
      
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
}
