/**
 * Thin HTTP client for the NeuronSearchLab API.
 *
 * Automatically injects Bearer tokens from the TokenManager and handles
 * retries (429 / 5xx) with exponential back-off.
 */
const DEFAULT_API_BASE = 'https://api.neuronsearchlab.com';
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
export class NeuronClient {
    tokenManager;
    staticToken;
    apiBase;
    timeoutMs;
    maxRetries;
    constructor(config) {
        if (!config.tokenManager && !config.staticToken) {
            throw new Error('NeuronClient requires either tokenManager or staticToken.');
        }
        this.tokenManager = config.tokenManager;
        this.staticToken = config.staticToken;
        this.apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
        this.timeoutMs = config.timeoutMs ?? 15_000;
        this.maxRetries = config.maxRetries ?? 2;
    }
    async request(method, path, body, queryParams) {
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
            const token = this.staticToken ?? await this.tokenManager.getToken();
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
                    if (!text)
                        return undefined;
                    return JSON.parse(text);
                }
                const raw = await res.text().catch(() => '');
                let errMsg;
                try {
                    const parsed = JSON.parse(raw);
                    errMsg = parsed.error ?? parsed.message ?? raw;
                }
                catch {
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
            }
            catch (err) {
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
                if (err.message?.startsWith('API error'))
                    throw err;
                if (attempt < this.maxRetries) {
                    attempt++;
                    await sleep(300 * Math.pow(2, attempt - 1));
                    continue;
                }
                throw err;
            }
        }
    }
    get(path, query) {
        return this.request('GET', path, undefined, query);
    }
    post(path, body) {
        return this.request('POST', path, body);
    }
    patch(path, body) {
        return this.request('PATCH', path, body);
    }
    put(path, body) {
        return this.request('PUT', path, body);
    }
    delete(path, body) {
        return this.request('DELETE', path, body);
    }
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
//# sourceMappingURL=client.js.map