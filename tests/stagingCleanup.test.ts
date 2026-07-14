import { describe, expect, it, vi } from "vitest";
import { createCleanupOnce } from "../src/stagingCleanup";

describe("createCleanupOnce", () => {
  it("runs cancellation cleanup at most once", async () => {
    const cleanup = vi.fn(async () => undefined);
    const cleanupOnce = createCleanupOnce(cleanup);

    await cleanupOnce();
    await cleanupOnce();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
