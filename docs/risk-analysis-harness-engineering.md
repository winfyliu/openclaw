# Harness Engineering 风险分析报告

> 本文档基于 `myfork/main` 分支的代码分析，总结了 Harness Engineering 功能引入的风险点和改进建议。

## 一、功能概述

Harness Engineering 是一套任务编排和执行框架，主要包含以下核心模块：

| 模块 | 文件 | 功能 |
|------|------|------|
| 任务状态机 | `task-events.ts` | 定义 9 种任务状态和转换规则 |
| 任务注册表 | `task-registry.ts` | 任务持久化和生命周期管理 |
| 任务编排器 | `task-orchestrator.ts` | 任务执行流程控制 |
| 任务恢复 | `task-resume.ts` | 凭据收集和任务恢复 |
| 资源锁 | `task-resource-locks.ts` | 并发控制和锁管理 |
| 子 Agent 管理 | `subagent-spawn.ts` | 子任务创建和角色分配 |
| 飞书通知 | `subagent-hooks.ts` | 状态更新推送到飞书 |

---

## 二、风险点汇总

### 🔴 高风险

#### 1. 凭据明文注入 Prompt

**位置**: `task-orchestrator.ts` → `forwardCredentialInputToTask`

**问题描述**:
用户提供的凭据（密码、Token 等）以明文形式直接注入到发送给子 Agent 的消息中：

```typescript
const message = [
  "User-provided input (untrusted content):",
  "<<<BEGIN_UNTRUSTED_USER_INPUT>>>",
  resumeDecision.credentials.raw,  // 明文凭据
  "<<<END_UNTRUSTED_USER_INPUT>>>",
].join("\n");
```

**风险影响**:
- 凭据可能被记录到日志中
- 如果子 Agent 调用外部服务，凭据可能被泄露
- 不符合安全最佳实践

**修复建议**:
- 使用临时 Token 替代真实凭据
- 或在内存中加密存储，使用时解密
- 添加敏感数据脱敏日志策略

---

#### 2. 凭据检测过于宽泛

**位置**: `task-resume.ts` → `parseCredentialFields`

**问题描述**:
只要消息中包含 `password`、`token` 等关键词，就会被识别为凭据回复：

```typescript
const hasCredentialKeyword =
  lowered.includes("password") ||
  lowered.includes("账号") ||
  lowered.includes("token") ||
  lowered.includes("api key") ||
  // ...
```

**风险影响**:
- 用户说 "我的 password 忘记了" 会被误识别为凭据
- 可能导致凭据被错误地转发到不相关的任务

**修复建议**:
- 增加上下文判断（如：是否紧跟等号或冒号）
- 要求用户使用特定格式提交凭据
- 添加确认机制

---

#### 3. 任务恢复竞态条件

**位置**: `task-orchestrator.ts` → `forwardCredentialInputToTask`

**问题描述**:
在获取资源锁后，没有重新检查任务状态是否仍然是 `blocked`：

```typescript
return await withTaskResourceLock({...}, async () => {
  const task = resolveTaskByIdOrRun({...});
  // 没有检查 task.status === 'blocked'
  // ... 直接转发凭据
});
```

**风险影响**:
- 任务可能已经超时或被取消
- 凭据被转发到一个无效的任务
- 状态不一致

**修复建议**:
```typescript
if (task.status !== 'blocked') {
  return { forwarded: false, error: "Task is no longer blocked" };
}
```

---

### 🟠 中风险

#### 4. Task ID 正则误匹配

**位置**: `task-resume.ts`

**问题描述**:
```typescript
const TASK_ID_RE = /\bT-[A-Z0-9]{4,}\b/i;
```

**风险影响**:
- "我需要 T-TEST 数据" 会被误识别为任务 ID
- "参考 T-ABCD1234 文档" 会被误识别

**修复建议**:
- 使用更严格的格式：`T-[A-Z0-9]{8,}`（至少 8 位）
- 或要求用户使用 `@T-XXXX` 格式

---

#### 5. 双重并发检查不一致

**位置**: `subagent-spawn.ts`

**问题描述**:
存在两套独立的并发控制：
- `subagent-registry`: 使用 `maxChildrenPerAgent`（默认 5）
- `task-registry`: 使用 `maxActiveTasksPerSession`（默认 5）

**风险影响**:
- 两个计数器独立维护，可能出现不一致
- 一个说有 3 个活跃任务，另一个说有 6 个

**修复建议**:
- 统一使用一个计数源
- 或明确两个检查的职责边界

---

#### 6. 资源锁无死锁检测

**位置**: `task-resource-locks.ts`

**问题描述**:
只有超时机制（默认 15 秒），没有死锁检测：

```typescript
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 15_000;
```

**风险影响**:
- 两个任务互相等待对方的锁会各自等 15 秒后超时
- 没有锁优先级机制

**修复建议**:
- 添加锁等待链检测
- 记录锁获取/释放日志便于排查

---

#### 7. 脱敏正则不完整

**位置**: `subagent-hooks.ts` → `redactSensitiveStatusText`

**问题描述**:
只处理了 `password=xxx`、`token=xxx` 格式，以下情况不会被脱敏：
- `密码是 123456`（中文冒号）
- `pass: 123456`（缩写）
- `key=sk-xxxxx`（不匹配 api_key 模式）

**修复建议**:
- 扩展脱敏规则覆盖更多格式
- 添加中文关键词支持

---

#### 8. Blocked 任务不会被 GC

**位置**: `task-registry.ts` → `applySessionTaskGcPolicy`

**问题描述**:
GC 只清理终态任务，`blocked` 状态的任务永远不会被清理：

```typescript
if (!isTerminalTaskStatus(task.status)) {
  continue; // 非终态任务不清理
}
```

**风险影响**:
- 用户创建大量任务后不管，blocked 任务会堆积
- 超过 `MAX_PERSISTED_TASKS_PER_SESSION = 40` 后新任务被拒绝

**修复建议**:
- 添加 blocked 任务超时自动取消（如 1 小时无响应）
- 或在达到上限时提示用户清理

---

#### 9. 凭据转发失败后状态不一致

**位置**: `task-orchestrator.ts`

**问题描述**:
转发失败后，任务状态仍然是 `blocked`，用户需要重新发送凭据。

**修复建议**:
- 提供重试机制
- 或自动恢复到之前的状态

---

#### 10. 懒加载移除影响启动性能

**位置**: `dispatch-from-config.ts`

**问题描述**:
所有懒加载被移除，改为静态 import：

```diff
-let routeReplyRuntimePromise: Promise<...> | null = null;
+import { getReplyFromConfig } from "../reply.js";
```

**风险影响**:
- 启动时间增加
- 内存占用增加

**修复建议**:
- 考虑恢复懒加载或使用条件加载
- 或评估实际影响是否可接受

---

### 🟡 低风险

#### 11. 飞书通知失败静默

**位置**: `subagent-hooks.ts`

**问题描述**:
```typescript
await sendFeishuSubagentStatusUpdate({...}).catch(() => {
  // Best effort: status updates should never fail task execution.
});
```

**风险影响**:
- 用户不知道状态更新没发出去
- 可能错过重要通知

**修复建议**:
- 添加重试机制
- 或在 UI 上提示用户

---

#### 12. 飞书多绑定歧义

**位置**: `subagent-hooks.ts` → `resolveFeishuRequesterConversation`

**问题描述**:
一个 session 绑定多个飞书会话时，状态通知可能发不到正确的会话。

**修复建议**:
- 要求用户明确指定目标会话
- 或广播到所有绑定的会话

---

#### 13. 子 Agent 角色分配边界条件

**位置**: `subagent-spawn.ts`

**问题描述**:
`childDepth` 计算错误时（如返回 -1），会导致角色分配异常。

**修复建议**:
- 添加 depth 边界检查
- 确保 `childDepth >= 1`

---

## 三、风险矩阵

| # | 风险 | 严重程度 | 类型 | 影响范围 |
|---|------|----------|------|----------|
| 1 | 凭据明文注入 Prompt | 🔴 高 | 安全 | 所有凭据收集场景 |
| 2 | 凭据检测过于宽泛 | 🔴 高 | 功能 | 用户消息解析 |
| 3 | 任务恢复竞态条件 | 🔴 高 | 稳定性 | 任务恢复流程 |
| 4 | Task ID 正则误匹配 | 🟠 中 | 功能 | 任务 ID 解析 |
| 5 | 双重并发检查不一致 | 🟠 中 | 架构 | 子任务创建 |
| 6 | 资源锁无死锁检测 | 🟠 中 | 稳定性 | 并发场景 |
| 7 | 脱敏正则不完整 | 🟠 中 | 安全 | 飞书通知 |
| 8 | Blocked 任务不 GC | 🟠 中 | 稳定性 | 长期运行 |
| 9 | 转发失败状态不一致 | 🟠 中 | 体验 | 任务恢复 |
| 10 | 懒加载移除 | 🟠 中 | 性能 | 启动时间 |
| 11 | 通知失败静默 | 🟡 低 | 体验 | 飞书集成 |
| 12 | 飞书多绑定歧义 | 🟡 低 | 功能 | 多会话场景 |
| 13 | 角色分配边界条件 | 🟡 低 | 功能 | 子任务创建 |

---

## 四、修复优先级建议

### P0 - 必须修复（合并前）
1. 凭据明文注入 Prompt
2. 任务恢复竞态条件

### P1 - 强烈建议修复
3. 凭据检测过于宽泛
4. Blocked 任务不 GC
5. 双重并发检查不一致

### P2 - 建议修复
6. Task ID 正则误匹配
7. 脱敏正则不完整
8. 资源锁无死锁检测

### P3 - 可后续优化
9. 转发失败状态不一致
10. 懒加载移除
11. 通知失败静默
12. 飞书多绑定歧义
13. 角色分配边界条件

---

## 五、测试建议

### 单元测试
- [ ] 任务状态转换矩阵完整性测试
- [ ] 凭据检测边界条件测试
- [ ] Task ID 正则匹配测试
- [ ] 资源锁超时和并发测试

### 集成测试
- [ ] 任务恢复端到端测试
- [ ] 飞书通知集成测试
- [ ] 并发任务创建压力测试

### 安全测试
- [ ] 凭据泄露风险评估
- [ ] 日志脱敏验证
- [ ] 权限边界测试

---

## 六、参考资料

- 相关提交：
  - `7038440ce2` - agents: add harness orchestration and Feishu task status updates
  - `d8d545bac1` - agents: complete harness execution hardening and quality gates
  - `a95e3e8c5a` - docs/feishu: sync harness references and task metadata updates

- 核心文件：
  - `src/agents/task-events.ts`
  - `src/agents/task-registry.ts`
  - `src/agents/task-orchestrator.ts`
  - `src/agents/task-resume.ts`
  - `src/agents/task-resource-locks.ts`
  - `src/agents/subagent-spawn.ts`
  - `extensions/feishu/src/subagent-hooks.ts`

---

*文档生成时间: 2026-03-23*
*分析基于: myfork/main 分支*
