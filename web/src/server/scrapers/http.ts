/**
 * HTTP for scrapers: each provider gets its own limits (requests at once,
 * time between requests), rate limits (429) and server errors are retried
 * after a pause, and a missing resource (404) is a normal answer, not an
 * error.
 */

export type Limits = { concurrency: number; intervalMs: number };

export const DEFAULT_LIMITS: Record<string, Limits> = {
  libretro: { concurrency: 4, intervalMs: 0 },
  // Hasheous allows about 60 lookups a minute.
  hasheous: { concurrency: 1, intervalMs: 1000 },
  wikipedia: { concurrency: 4, intervalMs: 0 },
};

export const USER_AGENT = "BeamRider/0.1 (https://github.com/ezand/beam-rider)";

export type Http = ReturnType<typeof createHttp>;

export function createHttp({ limits = DEFAULT_LIMITS, attempts = 4, retryDelayMs = 2000 } = {}) {
  const queues = new Map<string, { running: number; waiting: (() => void)[]; next: number }>();

  async function slot(provider: string) {
    const queue = queues.get(provider) ?? { running: 0, waiting: [], next: 0 };
    queues.set(provider, queue);
    const limit = limits[provider] ?? { concurrency: 2, intervalMs: 0 };
    while (queue.running >= limit.concurrency) await new Promise<void>((resolve) => queue.waiting.push(resolve));
    queue.running++;
    const wait = queue.next - Date.now();
    queue.next = Math.max(Date.now(), queue.next) + limit.intervalMs;
    if (wait > 0) await Bun.sleep(wait);
    return () => {
      queue.running--;
      queue.waiting.shift()?.();
    };
  }

  /** Fetches `url` for `provider`. Resolves to null for 404 and 410. */
  async function request(provider: string, url: string, init: RequestInit = {}): Promise<Response | null> {
    for (let attempt = 1; ; attempt++) {
      const release = await slot(provider);
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          headers: { "User-Agent": USER_AGENT, ...init.headers },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        release();
        if (attempt >= attempts) throw error;
        await Bun.sleep(retryDelayMs * attempt);
        continue;
      }
      release();
      if (response.status === 404 || response.status === 410) return null;
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        const after = Number(response.headers.get("retry-after"));
        await Bun.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : retryDelayMs * attempt);
        continue;
      }
      if (!response.ok) throw new Error(`${provider}: HTTP ${response.status} for ${url}`);
      return response;
    }
  }

  return {
    request,
    async json<T>(provider: string, url: string, init?: RequestInit): Promise<T | null> {
      const response = await request(provider, url, init);
      return response ? ((await response.json()) as T) : null;
    },
    /** Whether `url` exists, from a HEAD request. */
    async exists(provider: string, url: string): Promise<boolean> {
      return (await request(provider, url, { method: "HEAD" })) !== null;
    },
  };
}
