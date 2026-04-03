/**
 * Thin HTTP client for the NeuronSearchLab API.
 *
 * Automatically injects Bearer tokens from the TokenManager and handles
 * retries (429 / 5xx) with exponential back-off.
 */
import { TokenManager } from './auth.js';
export interface ClientConfig {
    tokenManager: TokenManager;
    apiBase?: string;
    timeoutMs?: number;
    maxRetries?: number;
}
export declare class NeuronClient {
    private readonly tokenManager;
    private readonly apiBase;
    private readonly timeoutMs;
    private readonly maxRetries;
    constructor(config: ClientConfig);
    request<T>(method: string, path: string, body?: unknown, queryParams?: Record<string, string | number | boolean | undefined>): Promise<T>;
    get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T>;
    post<T>(path: string, body: unknown): Promise<T>;
    patch<T>(path: string, body: unknown): Promise<T>;
    delete<T>(path: string, body?: unknown): Promise<T>;
}
//# sourceMappingURL=client.d.ts.map