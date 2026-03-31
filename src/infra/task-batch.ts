import { createSubsystemLogger } from '../logging/subsystem.js';

const log = createSubsystemLogger('infra/task-batch');

export interface BatchableTask {
  type: string;
  payload: any;
  timestamp: number;
  id: string;
}

export interface TaskBatch {
  tasks: BatchableTask[];
  type: string;
  createdAt: number;
  lastAdded: number;
}

export class TaskBatchProcessor {
  private batches: Map<string, TaskBatch> = new Map();
  private batchWindowMs: number;
  private maxBatchSize: number;

  constructor(options?: {
    batchWindowMs?: number;
    maxBatchSize?: number;
  }) {
    this.batchWindowMs = options?.batchWindowMs ?? 1000; // 1 second window
    this.maxBatchSize = options?.maxBatchSize ?? 10;
  }

  /**
   * Add a task to the batch processor
   */
  addTask(task: BatchableTask): void {
    const batchKey = this.getBatchKey(task);
    const existingBatch = this.batches.get(batchKey);

    if (existingBatch) {
      // Check if batch is still active
      const now = Date.now();
      if (now - existingBatch.lastAdded < this.batchWindowMs && existingBatch.tasks.length < this.maxBatchSize) {
        existingBatch.tasks.push(task);
        existingBatch.lastAdded = now;
        log.debug('Added task to existing batch', { batchKey, taskCount: existingBatch.tasks.length });
        return;
      }
    }

    // Create new batch
    const newBatch: TaskBatch = {
      tasks: [task],
      type: task.type,
      createdAt: Date.now(),
      lastAdded: Date.now(),
    };
    this.batches.set(batchKey, newBatch);
    log.debug('Created new batch', { batchKey });
  }

  /**
   * Get ready batches for processing
   */
  getReadyBatches(): TaskBatch[] {
    const now = Date.now();
    const readyBatches: TaskBatch[] = [];

    for (const [key, batch] of this.batches.entries()) {
      if (now - batch.lastAdded >= this.batchWindowMs || batch.tasks.length >= this.maxBatchSize) {
        readyBatches.push(batch);
        this.batches.delete(key);
      }
    }

    return readyBatches;
  }

  /**
   * Process all ready batches
   */
  processBatches(processor: (batch: TaskBatch) => void): void {
    const readyBatches = this.getReadyBatches();
    for (const batch of readyBatches) {
      try {
        processor(batch);
        log.debug('Processed batch', { batchType: batch.type, taskCount: batch.tasks.length });
      } catch (error) {
        log.error('Failed to process batch', { batchType: batch.type, error: String(error) });
      }
    }
  }

  /**
   * Get batch key for a task
   */
  private getBatchKey(task: BatchableTask): string {
    // Use task type as the primary key
    // For more granular batching, you could include other fields
    return task.type;
  }

  /**
   * Clear all batches
   */
  clear(): void {
    this.batches.clear();
  }

  /**
   * Get current batch count
   */
  getBatchCount(): number {
    return this.batches.size;
  }
}

// Global batch processor instance
export const globalBatchProcessor = new TaskBatchProcessor();

/**
 * Schedule batch processing at regular intervals
 */
export function startBatchProcessor(options?: {
  intervalMs?: number;
  processor?: (batch: TaskBatch) => void;
}) {
  const intervalMs = options?.intervalMs ?? 1000;
  const processor = options?.processor ?? defaultBatchProcessor;

  const interval = setInterval(() => {
    globalBatchProcessor.processBatches(processor);
  }, intervalMs);

  return () => clearInterval(interval);
}

/**
 * Default batch processor
 */
function defaultBatchProcessor(batch: TaskBatch): void {
  log.debug('Processing batch', { type: batch.type, taskCount: batch.tasks.length });
  // Default implementation - override with custom logic
}
