import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, loginHref } from "./apiClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient", () => {
  it("exposes workbench reads, the session and per-account watchlist edits only", () => {
    expect(Object.keys(apiClient).sort()).toEqual([
      "addWatchlistSymbol",
      "deleteAccount",
      "evaluateRatePlan",
      "fetchSnapshots",
      "getConfig",
      "getHistory",
      "getSession",
      "logout",
      "removeWatchlistSymbol",
      "resetWatchlist",
    ]);
  });

  it("sends watchlist edits as same-origin JSON and surfaces the error code", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ code: "WATCHLIST_SYMBOL_EXISTS" }), {
          status: 409,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiClient.addWatchlistSymbol("chips", { symbol: "AMD", rowId: "core" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "WATCHLIST_SYMBOL_EXISTS",
      message: "Request POST /api/watchlists/chips/symbols failed with 409",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/watchlists/chips/symbols");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ symbol: "BRK.B", watchlists: { watchlists: [] } })),
    );
    await apiClient.removeWatchlistSymbol("chips", "BRK.B");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/watchlists/chips/symbols/BRK.B");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });

  it("signs out with a same-origin JSON POST and builds safe sign-in links", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.logout();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/logout");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(loginHref("microsoft", "/?a=1&b=2")).toBe(
      "/api/auth/login/microsoft?returnTo=%2F%3Fa%3D1%26b%3D2",
    );
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
