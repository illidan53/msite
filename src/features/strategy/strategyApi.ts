import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export class StrategyApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code || String(status));
  }
}
export async function api<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
) {
  const response = await fetch(`/api${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    let code = "";
    try {
      code = ((await response.json()) as { code?: string }).code ?? "";
    } catch {
      /* Proxies and mocks may answer without a JSON body; the status is enough. */
    }
    throw new StrategyApiError(response.status, code);
  }
  return (await response.json()) as T;
}
export const errorStatus = (error: unknown) =>
  error instanceof StrategyApiError ? error.status : 0;

export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; error: StrategyApiError };

interface Store {
  cache: Record<string, Resource<unknown>>;
  generation: number;
  request(path: string): void;
  retry(path: string): void;
  /** Refetch every mounted resource, keeping current values until replacements arrive. */
  refresh(): void;
}
/** Lazily fetched, page-scoped GET cache shared by the Quant System tabs. */
export function useStrategyStore(): Store {
  const [cache, setCache] = useState<Record<string, Resource<unknown>>>({});
  const [generation, setGeneration] = useState(0);
  const current = useRef(0);
  const issued = useRef(new Map<string, number>());
  const request = useCallback((path: string) => {
    const gen = current.current;
    if (issued.current.get(path) === gen) return;
    issued.current.set(path, gen);
    // Only the latest request for a path may write, so a slow stale reply never wins.
    const latest = () => issued.current.get(path) === gen;
    void api<unknown>(path).then(
      (value) => {
        if (latest())
          setCache((c) => ({ ...c, [path]: { status: "ready", value } }));
      },
      (error: unknown) => {
        if (!latest()) return;
        const failure =
          error instanceof StrategyApiError
            ? error
            : new StrategyApiError(0, "NETWORK");
        setCache((c) =>
          c[path]?.status === "ready"
            ? c
            : { ...c, [path]: { status: "error", error: failure } },
        );
      },
    );
  }, []);
  const retry = useCallback((path: string) => {
    issued.current.delete(path);
    setCache((c) => {
      const next = { ...c };
      delete next[path];
      return next;
    });
  }, []);
  const refresh = useCallback(() => {
    current.current++;
    setGeneration(current.current);
  }, []);
  return useMemo(
    () => ({ cache, generation, request, retry, refresh }),
    [cache, generation, request, retry, refresh],
  );
}

export const StrategyStoreContext = createContext<Store | null>(null);
export function useResource<T>(path: string | null): Resource<T> | null {
  const store = useContext(StrategyStoreContext);
  if (!store) throw new Error("useResource needs a StrategyStoreContext");
  const entry = path ? store.cache[path] : undefined;
  const missing = entry === undefined;
  const { request, generation } = store;
  useEffect(() => {
    if (path) request(path);
  }, [path, missing, generation, request]);
  if (!path) return null;
  return (entry as Resource<T> | undefined) ?? { status: "loading" };
}
export function useRetry() {
  const store = useContext(StrategyStoreContext);
  return (path: string) => store?.retry(path);
}
