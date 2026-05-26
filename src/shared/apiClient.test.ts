import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./apiClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient", () => {
  it("only exposes file-backed workbench operations", () => {
    expect(Object.keys(apiClient).sort()).toEqual([
      "evaluateRatePlan",
      "fetchSnapshots",
      "getConfig",
      "getHistory",
    ]);
  });

  it("requests API data without using the browser cache", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.fetchSnapshots(["NVDA"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/market/snapshots",
      expect.objectContaining({
        cache: "no-store",
      }),
    );
  });
});
