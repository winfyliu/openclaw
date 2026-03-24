import { describe, expect, it } from "vitest";
import {
  canTransitionTaskNodeStatus,
  canTransitionTaskStatus,
  isTaskFailureStatus,
  isTaskNodeFailureStatus,
  isTaskNodePendingStatus,
  isTaskNodeTerminalStatus,
  isTaskPendingStatus,
  isTaskTerminalStatus,
} from "./task-events.js";
import {
  TASK_NODE_STATUS_CANCELLED,
  TASK_NODE_STATUS_COMPLETED,
  TASK_NODE_STATUS_CREATED,
  TASK_NODE_STATUS_FAILED,
  TASK_NODE_STATUS_RUNNING,
  TASK_NODE_STATUS_TIMEOUT,
  TASK_STATUS_ACCEPTED,
  TASK_STATUS_CANCELLED,
  TASK_STATUS_COMPLETED,
  TASK_STATUS_CREATED,
  TASK_STATUS_FAILED,
  TASK_STATUS_RUNNING,
  TASK_STATUS_WAITING_CHILDREN,
} from "./task-ledger.types.js";

describe("task-events", () => {
  it("accepts expected task lifecycle transitions", () => {
    expect(canTransitionTaskStatus(TASK_STATUS_CREATED, TASK_STATUS_ACCEPTED)).toBe(true);
    expect(canTransitionTaskStatus(TASK_STATUS_ACCEPTED, TASK_STATUS_RUNNING)).toBe(true);
    expect(canTransitionTaskStatus(TASK_STATUS_RUNNING, TASK_STATUS_WAITING_CHILDREN)).toBe(true);
    expect(canTransitionTaskStatus(TASK_STATUS_WAITING_CHILDREN, TASK_STATUS_COMPLETED)).toBe(
      true,
    );
    expect(canTransitionTaskStatus(TASK_STATUS_WAITING_CHILDREN, TASK_STATUS_FAILED)).toBe(true);
    expect(canTransitionTaskStatus(TASK_STATUS_RUNNING, TASK_STATUS_CANCELLED)).toBe(true);
  });

  it("rejects illegal task lifecycle transitions", () => {
    expect(canTransitionTaskStatus(TASK_STATUS_CREATED, TASK_STATUS_COMPLETED)).toBe(false);
    expect(canTransitionTaskStatus(TASK_STATUS_COMPLETED, TASK_STATUS_RUNNING)).toBe(false);
    expect(canTransitionTaskStatus(TASK_STATUS_FAILED, TASK_STATUS_ACCEPTED)).toBe(false);
    expect(canTransitionTaskStatus(TASK_STATUS_CANCELLED, TASK_STATUS_RUNNING)).toBe(false);
  });

  it("accepts expected task node transitions", () => {
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_CREATED, TASK_NODE_STATUS_RUNNING)).toBe(
      true,
    );
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_RUNNING, TASK_NODE_STATUS_COMPLETED)).toBe(
      true,
    );
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_RUNNING, TASK_NODE_STATUS_FAILED)).toBe(
      true,
    );
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_RUNNING, TASK_NODE_STATUS_TIMEOUT)).toBe(
      true,
    );
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_RUNNING, TASK_NODE_STATUS_CANCELLED)).toBe(
      true,
    );
  });

  it("rejects illegal task node transitions", () => {
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_CREATED, TASK_NODE_STATUS_CREATED)).toBe(
      true,
    );
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_COMPLETED, TASK_NODE_STATUS_RUNNING)).toBe(
      false,
    );
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_FAILED, TASK_NODE_STATUS_COMPLETED)).toBe(
      false,
    );
    expect(canTransitionTaskNodeStatus(TASK_NODE_STATUS_TIMEOUT, TASK_NODE_STATUS_RUNNING)).toBe(
      false,
    );
  });

  it("classifies task status buckets correctly", () => {
    expect(isTaskPendingStatus(TASK_STATUS_CREATED)).toBe(true);
    expect(isTaskPendingStatus(TASK_STATUS_ACCEPTED)).toBe(true);
    expect(isTaskPendingStatus(TASK_STATUS_RUNNING)).toBe(true);
    expect(isTaskPendingStatus(TASK_STATUS_WAITING_CHILDREN)).toBe(true);

    expect(isTaskTerminalStatus(TASK_STATUS_COMPLETED)).toBe(true);
    expect(isTaskTerminalStatus(TASK_STATUS_FAILED)).toBe(true);
    expect(isTaskTerminalStatus(TASK_STATUS_CANCELLED)).toBe(true);

    expect(isTaskFailureStatus(TASK_STATUS_FAILED)).toBe(true);
    expect(isTaskFailureStatus(TASK_STATUS_CANCELLED)).toBe(true);
    expect(isTaskFailureStatus(TASK_STATUS_COMPLETED)).toBe(false);
  });

  it("classifies task node status buckets correctly", () => {
    expect(isTaskNodePendingStatus(TASK_NODE_STATUS_CREATED)).toBe(true);
    expect(isTaskNodePendingStatus(TASK_NODE_STATUS_RUNNING)).toBe(true);

    expect(isTaskNodeTerminalStatus(TASK_NODE_STATUS_COMPLETED)).toBe(true);
    expect(isTaskNodeTerminalStatus(TASK_NODE_STATUS_FAILED)).toBe(true);
    expect(isTaskNodeTerminalStatus(TASK_NODE_STATUS_TIMEOUT)).toBe(true);
    expect(isTaskNodeTerminalStatus(TASK_NODE_STATUS_CANCELLED)).toBe(true);

    expect(isTaskNodeFailureStatus(TASK_NODE_STATUS_FAILED)).toBe(true);
    expect(isTaskNodeFailureStatus(TASK_NODE_STATUS_TIMEOUT)).toBe(true);
    expect(isTaskNodeFailureStatus(TASK_NODE_STATUS_CANCELLED)).toBe(true);
    expect(isTaskNodeFailureStatus(TASK_NODE_STATUS_COMPLETED)).toBe(false);
  });
});
