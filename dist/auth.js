/**
 * OAuth 2.0 Client Credentials token manager.
 *
 * Fetches a short-lived access token from the NeuronSearchLab token endpoint,
 * caches it in memory, and automatically refreshes it 60 seconds before expiry.
 */
const DEFAULT_TOKEN_URL = 'https://auth.neuronsearchlab.com/oauth2/token';
export class TokenManager {
    clientId;
    clientSecret;
    tokenUrl;
    token = null;
    expiresAt = 0;
    inflight = null;
    constructor(clientId, clientSecret, tokenUrl = DEFAULT_TOKEN_URL) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.tokenUrl = tokenUrl;
        if (!clientId || !clientSecret) {
            throw new Error('NSL_CLIENT_ID and NSL_CLIENT_SECRET are required. ' +
                'Generate credentials at https://console.neuronsearchlab.com/security');
        }
    }
    /** Returns a valid access token, refreshing if needed. */
    async getToken() {
        // Refresh 60 s before expiry to avoid races
        if (this.token && Date.now() < this.expiresAt - 60_000) {
            return this.token;
        }
        // Deduplicate concurrent refresh calls
        if (!this.inflight) {
            this.inflight = this.refresh().finally(() => { this.inflight = null; });
        }
        await this.inflight;
        return this.token;
    }
    async refresh() {
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        let res;
        try {
            res = await fetch(this.tokenUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'grant_type=client_credentials&scope=neuronsearchlab-api%2Fread%20neuronsearchlab-api%2Fwrite',
            });
        }
        catch (err) {
            throw new Error(`Token request failed (network error): ${err.message}`);
        }
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Token request failed: HTTP ${res.status} ${res.statusText}` +
                (body ? ` — ${body}` : ''));
        }
        const data = await res.json();
        if (!data.access_token) {
            throw new Error('Token response missing access_token field');
        }
        this.token = data.access_token;
        // expires_in is in seconds; default to 3600 if missing
        this.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    }
}
//# sourceMappingURL=auth.js.map