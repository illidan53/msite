import { ApiError } from "../http/apiError";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type QueryParams = Record<string, boolean | number | string | null | undefined>;

export class PolygonClient {
  private readonly baseUrl = "https://api.polygon.io";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async getJson<T>(path: string, params: QueryParams = {}): Promise<T> {
    const apiKey = this.apiKey?.trim();
    if (!apiKey) {
      throw new ApiError(503, "POLYGON_API_KEY_MISSING", "POLYGON_API_KEY is not configured", {
        source: "polygon",
      });
    }

    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("apiKey", apiKey);

    const response = await this.fetcher(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after") ?? undefined;
      throw new ApiError(response.status, "POLYGON_REQUEST_FAILED", "Polygon request failed", {
        details: retryAfter === undefined ? undefined : { retryAfter },
        source: "polygon",
      });
    }

    return (await response.json()) as T;
  }
}
