/**
 * Thin HTTP client for the NeuronSearchLab API.
 *
 * Automatically injects Bearer tokens from the TokenManager and handles
 * retries (429 / 5xx) with exponential back-off.
 */

import { TokenManager } from './auth.js';

const DEFAULT_API_BASE = 'https://api.neuronsearchlab.com';
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface ClientConfig {
  tokenManager: TokenManager;
  apiBase?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class NeuronClient {
  private readonly tokenManager: TokenManager;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: ClientConfig) {
    this.tokenManager = config.tokenManager;
    this.apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.apiBase}${path}`);

    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    let attempt = 0;
    while (true) {
      const token = await this.tokenManager.getToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
          const text = await res.text();
          if (!text) return undefined as unknown as T;
          return JSON.parse(text) as T;
        }

        const raw = await res.text().catch(() => '');
        let errMsg: string;
        try {
          const parsed = JSON.parse(raw);
          errMsg = parsed.error ?? parsed.message ?? raw;
        } catch {
          errMsg = raw;
        }

        if (RETRY_STATUSES.has(res.status) && attempt < this.maxRetries) {
          attempt++;
          const retryAfter = res.headers.get('retry-after');
          const delay = retryAfter && !isNaN(Number(retryAfter))
            ? Number(retryAfter) * 1000
            : 300 * Math.pow(2, attempt - 1) + Math.random() * 200;
          await sleep(delay);
          continue;
        }

        throw new Error(`API error ${res.status}: ${errMsg}`);
      } catch (err: any) {
        clearTimeout(timer);

        if (err.name === 'AbortError') {
          if (attempt < this.maxRetries) {
            attempt++;
            await sleep(300 * Math.pow(2, attempt - 1));
            continue;
          }
          throw new Error(`Request timed out after ${this.timeoutMs}ms`);
        }

        // Re-throw API errors as-is
        if (err.message?.startsWith('API error')) throw err;

        if (attempt < this.maxRetries) {
          attempt++;
          await sleep(300 * Math.pow(2, attempt - 1));
          continue;
        }

        throw err;
      }
    }
  }

  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, body);
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
