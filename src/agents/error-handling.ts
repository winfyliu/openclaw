import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/error-handling");

export enum ErrorType {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  INVALID_INPUT = 'invalid_input',
  API_ERROR = 'api_error',
  RESOURCE_LIMIT = 'resource_limit',
  UNKNOWN = 'unknown'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ErrorContext {
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  operation?: string;
  params?: any;
  retryCount?: number;
  maxRetries?: number;
}

export interface ErrorInfo {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  context?: ErrorContext;
  retryable: boolean;
  retryDelay?: number;
  timestamp: number;
}

export class ErrorHandler {
  private errorHistory: Map<string, ErrorInfo[]> = new Map();
  private maxErrorHistory: number = 100;

  classifyError(error: any, context?: ErrorContext): ErrorInfo {
    const errorInfo: ErrorInfo = {
      type: ErrorType.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      message: this.extractErrorMessage(error),
      originalError: error instanceof Error ? error : undefined,
      context,
      retryable: false,
      timestamp: Date.now()
    };

    // 网络错误
    if (this.isNetworkError(error)) {
      errorInfo.type = ErrorType.NETWORK;
      errorInfo.retryable = true;
      errorInfo.retryDelay = this.calculateRetryDelay(context?.retryCount || 0);
    }
    // 超时错误
    else if (this.isTimeoutError(error)) {
      errorInfo.type = ErrorType.TIMEOUT;
      errorInfo.severity = ErrorSeverity.HIGH;
      errorInfo.retryable = true;
      errorInfo.retryDelay = this.calculateRetryDelay(context?.retryCount || 0, true);
    }
    // 速率限制错误
    else if (this.isRateLimitError(error)) {
      errorInfo.type = ErrorType.RATE_LIMIT;
      errorInfo.severity = ErrorSeverity.MEDIUM;
      errorInfo.retryable = true;
      errorInfo.retryDelay = this.calculateRateLimitDelay(error);
    }
    // 输入错误
    else if (this.isInvalidInputError(error)) {
      errorInfo.type = ErrorType.INVALID_INPUT;
      errorInfo.severity = ErrorSeverity.LOW;
      errorInfo.retryable = false;
    }
    // 资源限制错误
    else if (this.isResourceLimitError(error)) {
      errorInfo.type = ErrorType.RESOURCE_LIMIT;
      errorInfo.severity = ErrorSeverity.HIGH;
      errorInfo.retryable = true;
      errorInfo.retryDelay = 5000;
    }
    // API错误
    else if (this.isApiError(error)) {
      errorInfo.type = ErrorType.API_ERROR;
      errorInfo.severity = ErrorSeverity.MEDIUM;
      errorInfo.retryable = this.isApiErrorRetryable(error);
      if (errorInfo.retryable) {
        errorInfo.retryDelay = this.calculateRetryDelay(context?.retryCount || 0);
      }
    }

    this.recordError(errorInfo);
    return errorInfo;
  }

  private extractErrorMessage(error: any): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error?.message) {
      return error.message;
    }
    if (error?.error) {
      return typeof error.error === 'string' ? error.error : JSON.stringify(error.error);
    }
    return 'Unknown error';
  }

  private isNetworkError(error: any): boolean {
    const networkErrorPatterns = [
      /network error/i,
      /connection refused/i,
      /timeout/i,
      /socket hang up/i,
      /ENOTFOUND/i,
      /EHOSTUNREACH/i,
      /ECONNREFUSED/i,
      /ECONNRESET/i
    ];
    const errorMessage = this.extractErrorMessage(error).toLowerCase();
    return networkErrorPatterns.some(pattern => pattern.test(errorMessage));
  }

  private isTimeoutError(error: any): boolean {
    const timeoutPatterns = [
      /timeout/i,
      /timed out/i,
      /ETIMEDOUT/i
    ];
    const errorMessage = this.extractErrorMessage(error).toLowerCase();
    return timeoutPatterns.some(pattern => pattern.test(errorMessage));
  }

  private isRateLimitError(error: any): boolean {
    const rateLimitPatterns = [
      /rate limit/i,
      /429/i,
      /too many requests/i,
      /quota exceeded/i
    ];
    const errorMessage = this.extractErrorMessage(error).toLowerCase();
    return rateLimitPatterns.some(pattern => pattern.test(errorMessage));
  }

  private isInvalidInputError(error: any): boolean {
    const inputErrorPatterns = [
      /invalid input/i,
      /bad request/i,
      /400/i,
      /validation error/i
    ];
    const errorMessage = this.extractErrorMessage(error).toLowerCase();
    return inputErrorPatterns.some(pattern => pattern.test(errorMessage));
  }

  private isResourceLimitError(error: any): boolean {
    const resourceErrorPatterns = [
      /out of memory/i,
      /memory limit/i,
      /disk full/i,
      /resource exhausted/i
    ];
    const errorMessage = this.extractErrorMessage(error).toLowerCase();
    return resourceErrorPatterns.some(pattern => pattern.test(errorMessage));
  }

  private isApiError(error: any): boolean {
    return error?.statusCode !== undefined || error?.code !== undefined;
  }

  private isApiErrorRetryable(error: any): boolean {
    const retryableStatusCodes = [429, 500, 502, 503, 504];
    if (error?.statusCode) {
      return retryableStatusCodes.includes(error.statusCode);
    }
    return false;
  }

  private calculateRetryDelay(retryCount: number, isTimeout: boolean = false): number {
    const baseDelay = isTimeout ? 10000 : 2000;
    const maxDelay = 60000;
    const delay = baseDelay * Math.pow(2, retryCount);
    return Math.min(delay, maxDelay);
  }

  private calculateRateLimitDelay(error: any): number {
    // 尝试从错误信息中提取重试时间
    const errorMessage = this.extractErrorMessage(error);
    const retryAfterMatch = errorMessage.match(/retry after (\d+) seconds/i);
    if (retryAfterMatch) {
      return parseInt(retryAfterMatch[1]) * 1000;
    }
    // 默认速率限制延迟
    return 30000;
  }

  private recordError(errorInfo: ErrorInfo) {
    const key = errorInfo.context?.sessionId || 'global';
    if (!this.errorHistory.has(key)) {
      this.errorHistory.set(key, []);
    }
    const errors = this.errorHistory.get(key)!;
    errors.push(errorInfo);
    
    // 保持错误历史在合理范围内
    if (errors.length > this.maxErrorHistory) {
      this.errorHistory.set(key, errors.slice(-this.maxErrorHistory));
    }
  }

  async retryOperation<T>(operation: () => Promise<T>, context?: ErrorContext): Promise<T> {
    const maxRetries = context?.maxRetries || 3;
    let lastError: ErrorInfo | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const errorInfo = this.classifyError(error, { ...context, retryCount: attempt });
        lastError = errorInfo;

        if (!errorInfo.retryable || attempt >= maxRetries) {
          throw error;
        }

        log.debug(`Retrying operation after ${errorInfo.retryDelay}ms (attempt ${attempt + 1}/${maxRetries})`, {
          errorType: errorInfo.type,
          errorMessage: errorInfo.message
        });

        await new Promise(resolve => setTimeout(resolve, errorInfo.retryDelay));
      }
    }

    throw lastError?.originalError || new Error('Operation failed after maximum retries');
  }

  getErrorStats(sessionId?: string): any {
    const key = sessionId || 'global';
    const errors = this.errorHistory.get(key) || [];
    
    const stats = {
      total: errors.length,
      byType: {} as Record<ErrorType, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
      recentErrors: errors.slice(-10)
    };

    errors.forEach(error => {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    });

    return stats;
  }

  clearErrorHistory(sessionId?: string) {
    if (sessionId) {
      this.errorHistory.delete(sessionId);
    } else {
      this.errorHistory.clear();
    }
  }
}

// 全局错误处理器实例
let globalErrorHandler: ErrorHandler | null = null;

export function getErrorHandler(): ErrorHandler {
  if (!globalErrorHandler) {
    globalErrorHandler = new ErrorHandler();
  }
  return globalErrorHandler;
}

export function shutdownErrorHandler() {
  if (globalErrorHandler) {
    globalErrorHandler.clearErrorHistory();
    globalErrorHandler = null;
  }
}
