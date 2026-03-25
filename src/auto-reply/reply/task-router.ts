export type TaskRoutePath = "fast_qa" | "task_path";
export type TaskRouteComplexity = "low" | "medium" | "high";

export type TaskRouteDecision = {
  path: TaskRoutePath;
  complexity: TaskRouteComplexity;
  ackText: string;
  needsPlanApproval: boolean;
  reasonShort: string;
  requiresExecutionApproval: boolean;
};

export type TaskRoutePolicySnapshot = {
  planApprovalMode?: "auto_execute" | "review_first" | "risk_based";
  riskyOps?: boolean;
  externalSideEffectsApproval?: boolean;
  costlyOpsApproval?: boolean;
};

function hasExternalSideEffectIntent(text: string): boolean {
  return /发送|推送|写入|创建|删除|更新线上|调用接口|发消息|post|webhook|publish|send|write|create|delete|update/.test(
    text,
  );
}

function hasCostlyOpsIntent(text: string): boolean {
  return /全量测试|跑全部测试|覆盖率|长时间|benchmark|load test|full test|test:coverage|pnpm test/.test(
    text,
  );
}

const DEFAULT_ACK: Record<TaskRouteComplexity, string> = {
  low: "好的，我马上处理。",
  medium: "好的，我来处理，可能需要一点时间。",
  high: "好的，这个问题有点复杂，我先拆解并验证一下。",
};

function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

function classifyComplexity(text: string): TaskRouteComplexity {
  if (
    /发布|部署|迁移|重构|故障|排查|优化|多步骤|pipeline|deploy|release|migrate|refactor|debug/.test(
      text,
    )
  ) {
    return "high";
  }
  if (/安装|修改|实现|编写|测试|run|build|install|fix|change|implement|write/.test(text)) {
    return "medium";
  }
  return "low";
}

function sanitizeAckText(ackText: string | undefined, complexity: TaskRouteComplexity): string {
  const text = (ackText ?? "").trim();
  if (!text) {
    return DEFAULT_ACK[complexity];
  }
  if (text.length > 80) {
    return `${text.slice(0, 80)}...`;
  }
  if (/子agent|subagent|tool chain|system prompt|内部/.test(text.toLowerCase())) {
    return DEFAULT_ACK[complexity];
  }
  return text;
}

export function decideTaskRoute(params: {
  body: string;
  isHeartbeat?: boolean;
  hasMediaAttachment?: boolean;
  policies?: TaskRoutePolicySnapshot;
}): TaskRouteDecision {
  const text = normalizeText(params.body);
  if (params.isHeartbeat) {
    return {
      path: "fast_qa",
      complexity: "low",
      ackText: "",
      needsPlanApproval: false,
      reasonShort: "heartbeat",
      requiresExecutionApproval: false,
    };
  }
  if (params.hasMediaAttachment) {
    return {
      path: "task_path",
      complexity: "medium",
      ackText: DEFAULT_ACK.medium,
      needsPlanApproval: false,
      reasonShort: "media_present",
      requiresExecutionApproval: Boolean(params.policies?.externalSideEffectsApproval),
    };
  }

  const externalEffectIntent = hasExternalSideEffectIntent(text);
  const costlyOpsIntent = hasCostlyOpsIntent(text);

  const taskLike =
    /安装|部署|迁移|修复|排查|重构|实现|编写|执行|run|build|deploy|install|fix|debug|refactor|implement|write/.test(text) ||
    externalEffectIntent ||
    costlyOpsIntent;
  if (!taskLike && text.length <= 120) {
    return {
      path: "fast_qa",
      complexity: "low",
      ackText: "",
      needsPlanApproval: false,
      reasonShort: "short_qa",
      requiresExecutionApproval: false,
    };
  }

  const complexity = classifyComplexity(text);
  const needsPlanApprovalByText = /先给我看|先确认|先审核|approve first|review first/.test(text);
  const needsPlanApprovalByPolicy =
    params.policies?.planApprovalMode === "review_first" ||
    (params.policies?.planApprovalMode === "risk_based" &&
      (complexity === "high" || params.policies?.riskyOps === true));
  const needsPlanApprovalByExternalEffect = Boolean(
    params.policies?.externalSideEffectsApproval && externalEffectIntent,
  );
  const needsPlanApprovalByCostlyOps = Boolean(
    params.policies?.costlyOpsApproval && costlyOpsIntent,
  );
  const needsPlanApproval =
    needsPlanApprovalByText ||
    needsPlanApprovalByPolicy ||
    needsPlanApprovalByExternalEffect ||
    needsPlanApprovalByCostlyOps;
  const requiresExecutionApproval =
    needsPlanApprovalByExternalEffect ||
    needsPlanApprovalByCostlyOps ||
    (params.policies?.planApprovalMode === "review_first" && complexity !== "low");
  return {
    path: "task_path",
    complexity,
    ackText: sanitizeAckText(DEFAULT_ACK[complexity], complexity),
    needsPlanApproval,
    reasonShort: taskLike ? "task_keywords" : "long_request",
    requiresExecutionApproval,
  };
}
