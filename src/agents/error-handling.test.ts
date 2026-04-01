import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorHandler, getErrorHandler, shutdownErrorHandler, ErrorType, ErrorSeverity } from './error-handling.js';

describe('ErrorHandler', () => {
  beforeEach(() => {
    shutdownErrorHandler();
  });

  afterEach(() => {
    shutdownErrorHandler();
  });

  it('should create an error handler', () => {
    const handler = getErrorHandler();
    expect(handler).toBeInstanceOf(ErrorHandler);
  });

  it('should classify network errors', () => {
    const handler = getErrorHandler();
    const error = new Error('Network error: connection refused');
    const result = handler.classifyError(error);
    
    expect(result.type).toBe(ErrorType.NETWORK);
    expect(result.retryable).toBe(true);
  });

  it('should classify timeout errors', () => {
    const handler = getErrorHandler();
    const error = new Error('Timeout exceeded');
    const result = handler.classifyError(error);
    
    expect(result.type).toBe(ErrorType.TIMEOUT);
    expect(result.retryable).toBe(true);
  });

  it('should classify rate limit errors', () => {
    const handler = getErrorHandler();
    const error = new Error('Rate limit exceeded, retry after 60 seconds');
    const result = handler.classifyError(error);
    
    expect(result.type).toBe(ErrorType.RATE_LIMIT);
    expect(result.retryable).toBe(true);
  });

  it('should classify invalid input errors', () => {
    const handler = getErrorHandler();
    const error = new Error('Invalid input: bad request');
    const result = handler.classifyError(error);
    
    expect(result.type).toBe(ErrorType.INVALID_INPUT);
    expect(result.retryable).toBe(false);
  });

  it('should classify API errors', () => {
    const handler = getErrorHandler();
    const error = { statusCode: 500, message: 'Internal server error' };
    const result = handler.classifyError(error);
    
    expect(result.type).toBe(ErrorType.API_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('should classify unknown errors', () => {
    const handler = getErrorHandler();
    const error = new Error('Unknown error');
    const result = handler.classifyError(error);
    
    expect(result.type).toBe(ErrorType.UNKNOWN);
    expect(result.retryable).toBe(false);
  });

  it('should retry operations', async () => {
    const handler = getErrorHandler();
    let attempt = 0;
    
    const operation = () => {
      attempt++;
      if (attempt < 3) {
        throw new Error('Network error');
      }
      return 'success';
    };
    
    const result = await handler.retryOperation(operation, { maxRetries: 3 });
    expect(result).toBe('success');
    expect(attempt).toBe(3);
  });

  it('should throw after maximum retries', async () => {
    const handler = getErrorHandler();
    let attempt = 0;
    
    const operation = () => {
      attempt++;
      throw new Error('Network error');
    };
    
    await expect(handler.retryOperation(operation, { maxRetries: 2 })).rejects.toThrow('Network error');
    expect(attempt).toBe(3); // 1 initial + 2 retries
  });

  it('should not retry non-retryable errors', async () => {
    const handler = getErrorHandler();
    let attempt = 0;
    
    const operation = () => {
      attempt++;
      throw new Error('Invalid input');
    };
    
    await expect(handler.retryOperation(operation, { maxRetries: 3 })).rejects.toThrow('Invalid input');
    expect(attempt).toBe(1); // No retries
  });

  it('should get error stats', () => {
    const handler = getErrorHandler();
    const error = new Error('Network error');
    handler.classifyError(error);
    
    const stats = handler.getErrorStats();
    expect(stats.total).toBe(1);
    expect(stats.byType[ErrorType.NETWORK]).toBe(1);
  });

  it('should clear error history', () => {
    const handler = getErrorHandler();
    const error = new Error('Network error');
    handler.classifyError(error);
    
    expect(handler.getErrorStats().total).toBe(1);
    handler.clearErrorHistory();
    expect(handler.getErrorStats().total).toBe(0);
  });
});
