import { describe, expect, it, vi } from "vitest";
import { __resetRegisterLogOnceForTests, logRegisterOnce } from "./register-log-once.js";

describe("logRegisterOnce", () => {
  it("logs only once per key", () => {
    __resetRegisterLogOnceForTests();
    const logger = vi.fn<(message: string) => void>();

    logRegisterOnce(logger, "k1", "registered k1");
    logRegisterOnce(logger, "k1", "registered k1 again");
    logRegisterOnce(logger, "k2", "registered k2");

    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger).toHaveBeenNthCalledWith(1, "registered k1");
    expect(logger).toHaveBeenNthCalledWith(2, "registered k2");
  });
});
