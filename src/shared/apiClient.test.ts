import { describe, expect, it } from "vitest";
import { apiClient } from "./apiClient";

describe("apiClient", () => {
  it("only exposes file-backed workbench operations", () => {
    expect(Object.keys(apiClient).sort()).toEqual([
      "evaluateRatePlan",
      "fetchSnapshots",
      "getConfig",
      "getHistory",
    ]);
  });
});
